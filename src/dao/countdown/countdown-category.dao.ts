import type { Knex } from "knex";
import KnexManager from "../../database/KnexConnection";
import {
  ICountdownCategory,
  ICountdownSubcategory,
} from "../../interfaces/countdown/countdown.interfaces";
import { toCountOut } from "../../utils/numbers";

const CATEGORIES_TABLE = "countdown_categories";
const SUBCATEGORIES_TABLE = "countdown_subcategories";
const DOCUMENTS_TABLE = "countdown_documents";

/**
 * Row shapes stay inside the DAO/service layer: they carry the serial ids the
 * API must never expose (`sanitizeResponse` strips them, but nothing should
 * produce them in the first place).
 */
export interface ICountdownCategoryRow {
  id: number;
  uuid: string;
  companyId: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICountdownSubcategoryRow {
  id: number;
  uuid: string;
  categoryId: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ICountRow {
  key: number;
  count: string;
}

/** `count(*)` comes back from pg as a string; never let one reach the API. */
function toCountMap(rows: ICountRow[]): Map<number, number> {
  return new Map(rows.map((row) => [row.key, toCountOut(row.count)]));
}

export class CountdownCategoryDAO {
  /**
   * Rubros with their sub-rubros and usage counts, in three queries rather than
   * one per row. Ordered by name because this list is a picker before it is a
   * management screen.
   */
  async list(companyId: number): Promise<ICountdownCategory[]> {
    const knex = KnexManager.getConnection();

    const categories = await knex<ICountdownCategoryRow>(CATEGORIES_TABLE)
      .where({ companyId })
      .orderBy("name");
    if (categories.length === 0) return [];

    const categoryIds = categories.map((category) => category.id);

    const [subcategories, categoryCountRows, subcategoryCountRows] =
      await Promise.all([
        knex<ICountdownSubcategoryRow>(SUBCATEGORIES_TABLE)
          .whereIn("categoryId", categoryIds)
          .orderBy("name"),
        // Documents carry their own companyId, so the counts are scoped twice:
        // by tenant and by the rubro ids we already know belong to that tenant.
        knex(DOCUMENTS_TABLE)
          .where({ companyId })
          .whereIn("categoryId", categoryIds)
          .groupBy("categoryId")
          .select("categoryId as key")
          .count<ICountRow[]>("* as count"),
        knex(DOCUMENTS_TABLE)
          .where({ companyId })
          .whereNotNull("subcategoryId")
          .groupBy("subcategoryId")
          .select("subcategoryId as key")
          .count<ICountRow[]>("* as count"),
      ]);

    const byCategory = toCountMap(categoryCountRows);
    const bySubcategory = toCountMap(subcategoryCountRows);

    return categories.map((category) => ({
      uuid: category.uuid,
      name: category.name,
      createdAt: category.createdAt,
      documentCount: byCategory.get(category.id) ?? 0,
      subcategories: subcategories
        .filter((subcategory) => subcategory.categoryId === category.id)
        .map(
          (subcategory): ICountdownSubcategory => ({
            uuid: subcategory.uuid,
            name: subcategory.name,
            documentCount: bySubcategory.get(subcategory.id) ?? 0,
          }),
        ),
    }));
  }

  /**
   * (L-005) Serial ids are resolved explicitly, never carried in a mapper.
   * A uuid belonging to another company resolves to nothing, which the
   * controller turns into a 404 — existence never leaks across tenants.
   */
  async getIdByUuid(
    uuid: string,
    companyId: number,
  ): Promise<number | undefined> {
    const knex = KnexManager.getConnection();
    const row = await knex<ICountdownCategoryRow>(CATEGORIES_TABLE)
      .select("id")
      .where({ uuid, companyId })
      .first();
    return row?.id;
  }

  async getByUuid(
    uuid: string,
    companyId: number,
  ): Promise<ICountdownCategoryRow | undefined> {
    const knex = KnexManager.getConnection();
    return knex<ICountdownCategoryRow>(CATEGORIES_TABLE)
      .where({ uuid, companyId })
      .first();
  }

  /** Clash check: per company and case-insensitive ("IVA" and "iva" are one rubro). */
  async findByName(
    companyId: number,
    name: string,
  ): Promise<ICountdownCategoryRow | undefined> {
    const knex = KnexManager.getConnection();
    return knex<ICountdownCategoryRow>(CATEGORIES_TABLE)
      .where({ companyId })
      .whereRaw("lower(name) = lower(?)", [name.trim()])
      .first();
  }

  async create(
    companyId: number,
    uuid: string,
    name: string,
  ): Promise<ICountdownCategoryRow> {
    const knex = KnexManager.getConnection();
    const rows = await knex<ICountdownCategoryRow>(CATEGORIES_TABLE)
      .insert({ uuid, companyId, name: name.trim() })
      .returning("*");
    const created = rows[0];
    if (!created)
      throw new Error("[CountdownCategoryDAO] insert returned no row");
    return created;
  }

  async rename(companyId: number, id: number, name: string): Promise<void> {
    const knex = KnexManager.getConnection();
    await knex<ICountdownCategoryRow>(CATEGORIES_TABLE)
      .where({ id, companyId })
      .update({ name: name.trim(), updatedAt: knex.fn.now() });
  }

  async delete(companyId: number, id: number): Promise<void> {
    const knex = KnexManager.getConnection();
    await knex<ICountdownCategoryRow>(CATEGORIES_TABLE)
      .where({ id, companyId })
      .delete();
  }

  /** Documents on the rubro itself or on any of its sub-rubros. */
  async countDocuments(companyId: number, id: number): Promise<number> {
    const knex = KnexManager.getConnection();
    const rows = await knex(DOCUMENTS_TABLE)
      .where({ companyId })
      .andWhere((builder) => {
        builder
          .where("categoryId", id)
          .orWhereIn(
            "subcategoryId",
            knex(SUBCATEGORIES_TABLE).select("id").where("categoryId", id),
          );
      })
      .count<{ count: string }[]>("* as count");
    return toCountOut(rows[0]?.count);
  }
}

export class CountdownSubcategoryDAO {
  /**
   * Sub-rubros have no companyId column: they reach the tenant through their
   * rubro. Every lookup therefore goes through this scoped-id subquery, so a
   * uuid from another company simply matches nothing.
   */
  private scopedCategoryIds(
    knex: Knex<any, unknown[]>,
    companyId: number,
  ): Knex.QueryBuilder {
    return knex(CATEGORIES_TABLE).select("id").where({ companyId });
  }

  async getIdByUuid(
    uuid: string,
    companyId: number,
  ): Promise<number | undefined> {
    const knex = KnexManager.getConnection();
    const row = await knex<ICountdownSubcategoryRow>(SUBCATEGORIES_TABLE)
      .select("id")
      .where({ uuid })
      .whereIn("categoryId", this.scopedCategoryIds(knex, companyId))
      .first();
    return row?.id;
  }

  async findByUuid(
    uuid: string,
    companyId: number,
  ): Promise<ICountdownSubcategoryRow | undefined> {
    const knex = KnexManager.getConnection();
    return knex<ICountdownSubcategoryRow>(SUBCATEGORIES_TABLE)
      .where({ uuid })
      .whereIn("categoryId", this.scopedCategoryIds(knex, companyId))
      .first();
  }

  /** categoryId is already tenant-resolved by the caller; names clash per rubro. */
  async findByName(
    categoryId: number,
    name: string,
  ): Promise<ICountdownSubcategoryRow | undefined> {
    const knex = KnexManager.getConnection();
    return knex<ICountdownSubcategoryRow>(SUBCATEGORIES_TABLE)
      .where({ categoryId })
      .whereRaw("lower(name) = lower(?)", [name.trim()])
      .first();
  }

  async create(
    categoryId: number,
    uuid: string,
    name: string,
  ): Promise<ICountdownSubcategoryRow> {
    const knex = KnexManager.getConnection();
    const rows = await knex<ICountdownSubcategoryRow>(SUBCATEGORIES_TABLE)
      .insert({ uuid, categoryId, name: name.trim() })
      .returning("*");
    const created = rows[0];
    if (!created) {
      throw new Error("[CountdownSubcategoryDAO] insert returned no row");
    }
    return created;
  }

  async rename(companyId: number, id: number, name: string): Promise<void> {
    const knex = KnexManager.getConnection();
    await knex<ICountdownSubcategoryRow>(SUBCATEGORIES_TABLE)
      .where({ id })
      .whereIn("categoryId", this.scopedCategoryIds(knex, companyId))
      .update({ name: name.trim(), updatedAt: knex.fn.now() });
  }

  async delete(companyId: number, id: number): Promise<void> {
    const knex = KnexManager.getConnection();
    await knex<ICountdownSubcategoryRow>(SUBCATEGORIES_TABLE)
      .where({ id })
      .whereIn("categoryId", this.scopedCategoryIds(knex, companyId))
      .delete();
  }

  async countDocuments(companyId: number, id: number): Promise<number> {
    const knex = KnexManager.getConnection();
    const rows = await knex(DOCUMENTS_TABLE)
      .where({ companyId, subcategoryId: id })
      .count<{ count: string }[]>("* as count");
    return toCountOut(rows[0]?.count);
  }
}
