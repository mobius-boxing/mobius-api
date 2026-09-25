import { Request } from "express";
import { Knex } from "knex";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import {
  applyCompanyScope,
  companyFilterScope,
  type CompanyScope,
} from "../../utils/daoScope";
import { parseEnumParam } from "../../utils/query-params";
import { toCountOut } from "../../utils/numbers";
import {
  ICorrugatorPlan,
  CORRUGATOR_PLAN_STATUSES,
  CorrugatorPlanStatus,
} from "../../interfaces/corrugator-plan/corrugator-plan.interfaces";

const TABLE = "corrugator_plans";

/** Header-only CRUD + list. Lines/combinations/items live in sibling DAOs; the
 * cross-table orchestration (pool, seeding, solve, register) lives in
 * `services/corrugator/plan.service.ts` — this DAO stays a thin table facade
 * so that service can compose it inside its own transactions. */
export class CorrugatorPlanDAO {
  private tableName = TABLE;

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? db("tenant");
  }

  /** `max(number)+1` inside the caller's own create transaction (model.md, unique violation → one retry). */
  async nextNumber(trx: Knex.Transaction, companyId: number): Promise<number> {
    const row = await trx(this.tableName)
      .where("companyId", companyId)
      .max("number as max")
      .first();
    return (row?.max ?? 0) + 1;
  }

  async create(
    item: ICorrugatorPlan,
    trx?: Knex.Transaction,
  ): Promise<ICorrugatorPlan> {
    const knex = this.conn(trx);
    const [row] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        companyId: item.companyId,
        number: item.number,
        name: item.name ?? null,
        notes: item.notes ?? null,
        status: item.status ?? "draft",
        board: JSON.stringify(item.board),
        machines: JSON.stringify(item.machines ?? []),
        parameters: JSON.stringify(item.parameters),
        createdByUser: item.createdByUser ?? null,
      })
      .returning("*");
    return this.mapToInterface(row);
  }

  async getByUuid(
    uuid: string,
    companyId?: CompanyScope,
    trx?: Knex.Transaction,
  ): Promise<ICorrugatorPlan | null> {
    const knex = this.conn(trx);
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyScope(query, this.tableName, companyId);
    const row = await query.first();
    return row ? this.mapToInterface(row) : null;
  }

  async getById(
    id: number,
    trx?: Knex.Transaction,
  ): Promise<ICorrugatorPlan | null> {
    const knex = this.conn(trx);
    const row = await knex(this.tableName).where("id", id).first();
    return row ? this.mapToInterface(row) : null;
  }

  async getIdByUuid(
    uuid: string,
    companyId?: CompanyScope,
  ): Promise<number | null> {
    const knex = db("tenant");
    const query = knex(this.tableName).where("uuid", uuid);
    applyCompanyScope(query, this.tableName, companyId);
    const row = await query.select("id").first();
    return row?.id ?? null;
  }

  async update(
    id: number,
    item: Partial<ICorrugatorPlan>,
    trx?: Knex.Transaction,
  ): Promise<ICorrugatorPlan | null> {
    const knex = this.conn(trx);
    const updateData: Record<string, unknown> = {};
    if (item.name !== undefined) updateData.name = item.name;
    if (item.notes !== undefined) updateData.notes = item.notes;
    if (item.status !== undefined) updateData.status = item.status;
    if (item.board !== undefined) updateData.board = JSON.stringify(item.board);
    if (item.machines !== undefined)
      updateData.machines = JSON.stringify(item.machines);
    if (item.parameters !== undefined)
      updateData.parameters = JSON.stringify(item.parameters);
    if (item.solveToken !== undefined) updateData.solveToken = item.solveToken;
    if (item.solveStartedAt !== undefined)
      updateData.solveStartedAt = item.solveStartedAt;
    if (item.solveFinishedAt !== undefined)
      updateData.solveFinishedAt = item.solveFinishedAt;
    if (item.solveStatus !== undefined)
      updateData.solveStatus = item.solveStatus;
    if (item.solveLog !== undefined) updateData.solveLog = item.solveLog;
    if (item.combinationsGenerated !== undefined)
      updateData.combinationsGenerated = item.combinationsGenerated;
    if (item.registeredAt !== undefined)
      updateData.registeredAt = item.registeredAt;
    if (item.registeredByUser !== undefined)
      updateData.registeredByUser = item.registeredByUser;
    updateData.updatedAt = knex.fn.now();

    const [row] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");
    return row ? this.mapToInterface(row) : null;
  }

  async delete(id: number, trx?: Knex.Transaction): Promise<boolean> {
    const knex = this.conn(trx);
    const deleted = await knex(this.tableName).where("id", id).delete();
    return deleted > 0;
  }

  async getAllWithFilters(
    req: Request,
  ): Promise<IDataPaginator<ICorrugatorPlan>> {
    const knex = db("tenant");
    const companyId = companyFilterScope(req);
    const page = Math.max(parseInt(String(req.query.page ?? "1"), 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1),
      100,
    );
    const sortBy = String(req.query.sortBy ?? "createdAt");
    const sortOrder =
      String(req.query.sortOrder ?? "desc").toLowerCase() === "asc"
        ? "asc"
        : "desc";
    const sortable = new Set(["number", "createdAt", "status", "updatedAt"]);
    const sortColumn = sortable.has(sortBy) ? sortBy : "createdAt";

    const status = parseEnumParam(
      "status",
      req.query.status,
      CORRUGATOR_PLAN_STATUSES,
    );
    const number =
      req.query.number !== undefined ? String(req.query.number) : undefined;
    const createdByUser =
      req.query.createdByUser !== undefined
        ? String(req.query.createdByUser)
        : undefined;
    const search =
      req.query.search !== undefined ? String(req.query.search) : undefined;

    const applyFilters = (q: Knex.QueryBuilder) => {
      applyCompanyScope(q, this.tableName, companyId);
      if (status) q.where(`${this.tableName}.status`, status);
      if (number) q.where(`${this.tableName}.number`, number);
      if (createdByUser)
        q.where(
          `${this.tableName}.createdByUser`,
          "ILIKE",
          `%${createdByUser}%`,
        );
      if (search) {
        q.where((b) => {
          b.where(`${this.tableName}.name`, "ILIKE", `%${search}%`).orWhereRaw(
            `${this.tableName}.number::text ILIKE ?`,
            [`%${search}%`],
          );
        });
      }
      return q;
    };

    const dataQuery = applyFilters(
      knex(this.tableName).select(
        `${this.tableName}.*`,
        knex.raw(
          `(SELECT count(*) FROM corrugator_plan_orders o WHERE o."planId" = ${this.tableName}.id) as "orderCount"`,
        ),
        knex.raw(
          `(SELECT count(*) FROM corrugator_plan_combinations c WHERE c."planId" = ${this.tableName}.id) as "combinationCount"`,
        ),
      ),
    )
      .orderBy(sortColumn, sortOrder)
      .limit(limit)
      .offset((page - 1) * limit);

    const countQuery = applyFilters(knex(this.tableName));

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);
    const totalCount = toCountOut(totalResult?.count);

    return {
      success: true,
      data: rows.map((row: any) => ({
        ...this.mapToInterface(row),
        orderCount: toCountOut(row.orderCount),
        combinationCount: toCountOut(row.combinationCount),
      })),
      page,
      limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  mapToInterface(record: any): ICorrugatorPlan {
    return {
      id: record.id,
      companyId: record.companyId,
      uuid: record.uuid,
      number: record.number,
      name: record.name ?? null,
      notes: record.notes ?? null,
      status: record.status as CorrugatorPlanStatus,
      board: record.board,
      machines: record.machines ?? [],
      parameters: record.parameters,
      solveToken: record.solveToken ?? null,
      solveStartedAt: record.solveStartedAt ?? null,
      solveFinishedAt: record.solveFinishedAt ?? null,
      solveStatus: record.solveStatus ?? null,
      solveLog: record.solveLog ?? null,
      combinationsGenerated: record.combinationsGenerated ?? null,
      registeredAt: record.registeredAt ?? null,
      registeredByUser: record.registeredByUser ?? null,
      createdByUser: record.createdByUser ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
