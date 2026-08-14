import { Knex } from "knex";
import { db } from "../../database/registry";
import {
  CountdownDocumentStatus,
  ICountdownDocument,
  ICountdownDocumentEntry,
  ICountdownDocumentFilters,
  ICountdownDocumentRow,
  ICountdownDocumentSummary,
  ICountdownDocumentWriteInput,
  INamedRef,
  emptyCountdownAssignments,
} from "../../interfaces/countdown/countdown.interfaces";
import { toCountOut } from "../../utils/numbers";

const DOCUMENTS_TABLE = "countdown_documents";
const CATEGORIES_TABLE = "countdown_categories";
const SUBCATEGORIES_TABLE = "countdown_subcategories";
const USERS_TABLE = "users";

/** How many rows an export may carry. Well past anything this module will see;
 *  present so a runaway query cannot exhaust a 256 MB container. */
export const COUNTDOWN_EXPORT_ROW_CAP = 5000;

/** Client sort keys never reach the SQL string — they map through this. */
const SORT_ALLOWLIST: Record<string, string> = {
  dueDate: `${DOCUMENTS_TABLE}.dueDate`,
  createdAt: `${DOCUMENTS_TABLE}.createdAt`,
  amountCents: `${DOCUMENTS_TABLE}.amountCents`,
  title: `${DOCUMENTS_TABLE}.title`,
  issuer: `${DOCUMENTS_TABLE}.issuer`,
};

const DEFAULT_SORT_COLUMN = SORT_ALLOWLIST.dueDate as string;

interface IJoinedDocumentRow extends ICountdownDocumentRow {
  uploaderUuid: string | null;
  uploaderFirstName: string | null;
  uploaderLastName: string | null;
  resolverFirstName: string | null;
  resolverLastName: string | null;
  categoryUuid: string | null;
  categoryName: string | null;
  subcategoryUuid: string | null;
  subcategoryName: string | null;
  overdue: boolean;
  daysUntilDue: number;
}

function named(uuid: string | null, name: string | null): INamedRef | null {
  return uuid && name ? { uuid, name } : null;
}

/** Same composition the reminder DAO uses, so a person reads the same everywhere. */
function personName(
  firstName: string | null,
  lastName: string | null,
): string | null {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name === "" ? null : name;
}

function toCountdownDocument(row: IJoinedDocumentRow): ICountdownDocument {
  return {
    uuid: row.uuid,
    title: row.title,
    issuer: row.issuer,
    referenceNumber: row.referenceNumber,
    category: named(row.categoryUuid, row.categoryName),
    subcategory: named(row.subcategoryUuid, row.subcategoryName),
    notes: row.notes,
    amountCents: row.amountCents,
    currency: row.currency,
    dueDate: row.dueDate,
    status: row.status,
    recurrence:
      row.recurrenceCount && row.recurrenceUnit
        ? { count: row.recurrenceCount, unit: row.recurrenceUnit }
        : null,
    reminderDays: row.reminderDays,
    overdue: Boolean(row.overdue),
    daysUntilDue: toCountOut(row.daysUntilDue),
    resolvedAt: row.resolvedAt,
    resolvedByName: personName(row.resolverFirstName, row.resolverLastName),
    uploadedBy: named(
      row.uploaderUuid,
      personName(row.uploaderFirstName, row.uploaderLastName),
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...emptyCountdownAssignments(),
    // Unassigned means anyone may resolve; the service narrows this once it
    // knows who is asking and what the document is assigned to.
    canResolve: true,
  };
}

/**
 * One filter builder shared by the list, its count query and the export — the
 * three can never disagree, and (hard lesson L-007) every accepted parameter
 * actually does something. It only ever touches `countdown_documents`, so it is
 * safe on the count query, which carries no joins.
 *
 * `today` is bound, never interpolated, and never `current_date`: the host sets
 * no session timezone, so the customer's calendar day comes in from
 * `todayInBuenosAires()` — one definition of today across list, count and export.
 */
function applyFilters(
  query: Knex.QueryBuilder,
  filters: ICountdownDocumentFilters,
  today: string,
): Knex.QueryBuilder {
  if (filters.status === "pending" || filters.status === "resolved") {
    query.where(`${DOCUMENTS_TABLE}.status`, filters.status);
  } else if (filters.status === "overdue") {
    query
      .where(`${DOCUMENTS_TABLE}.status`, "pending")
      .whereRaw(`${DOCUMENTS_TABLE}."dueDate" < ?::date`, [today]);
  }

  if (filters.search) {
    const term = `%${filters.search.trim()}%`;
    query.where((builder) => {
      builder
        .whereILike(`${DOCUMENTS_TABLE}.title`, term)
        .orWhereILike(`${DOCUMENTS_TABLE}.issuer`, term)
        .orWhereILike(`${DOCUMENTS_TABLE}.referenceNumber`, term);
    });
  }

  if (filters.dueFrom)
    query.where(`${DOCUMENTS_TABLE}.dueDate`, ">=", filters.dueFrom);
  if (filters.dueTo)
    query.where(`${DOCUMENTS_TABLE}.dueDate`, "<=", filters.dueTo);
  if (filters.categoryId !== undefined)
    query.where(`${DOCUMENTS_TABLE}.categoryId`, filters.categoryId);

  return query;
}

/**
 * Documents, always scoped to one company (L-009): every method takes a
 * `companyId` and filters `countdown_documents."companyId"` with it. A document
 * from another tenant resolves to nothing, which the controller turns into a 404
 * — existence never leaks across companies, and never as a 403.
 */
export class CountdownDocumentDAO {
  /**
   * `overdue` and `daysUntilDue` are derived per query from the customer's
   * calendar day, never stored: a stored flag is stale the moment midnight passes
   * in Buenos Aires.
   */
  private baseQuery(companyId: number, today: string): Knex.QueryBuilder {
    const knex = db("countdown");
    return knex(DOCUMENTS_TABLE)
      .leftJoin(
        `${USERS_TABLE} as uploader`,
        "uploader.id",
        `${DOCUMENTS_TABLE}.uploadedBy`,
      )
      .leftJoin(
        `${USERS_TABLE} as resolver`,
        "resolver.id",
        `${DOCUMENTS_TABLE}.resolvedBy`,
      )
      .leftJoin(
        CATEGORIES_TABLE,
        `${CATEGORIES_TABLE}.id`,
        `${DOCUMENTS_TABLE}.categoryId`,
      )
      .leftJoin(
        SUBCATEGORIES_TABLE,
        `${SUBCATEGORIES_TABLE}.id`,
        `${DOCUMENTS_TABLE}.subcategoryId`,
      )
      .where(`${DOCUMENTS_TABLE}.companyId`, companyId)
      .select(
        `${DOCUMENTS_TABLE}.*`,
        "uploader.uuid as uploaderUuid",
        "uploader.firstName as uploaderFirstName",
        "uploader.lastName as uploaderLastName",
        "resolver.firstName as resolverFirstName",
        "resolver.lastName as resolverLastName",
        `${CATEGORIES_TABLE}.uuid as categoryUuid`,
        `${CATEGORIES_TABLE}.name as categoryName`,
        `${SUBCATEGORIES_TABLE}.uuid as subcategoryUuid`,
        `${SUBCATEGORIES_TABLE}.name as subcategoryName`,
        knex.raw(
          `(${DOCUMENTS_TABLE}."dueDate" < ?::date and ${DOCUMENTS_TABLE}.status = 'pending') as "overdue"`,
          [today],
        ),
        knex.raw(`(${DOCUMENTS_TABLE}."dueDate" - ?::date) as "daysUntilDue"`, [
          today,
        ]),
      );
  }

  async list(
    companyId: number,
    filters: ICountdownDocumentFilters,
    today: string,
    page: number,
    limit: number,
  ): Promise<{ rows: ICountdownDocumentEntry[]; totalCount: number }> {
    const knex = db("countdown");
    const sortColumn =
      (filters.sortBy && SORT_ALLOWLIST[filters.sortBy]) ?? DEFAULT_SORT_COLUMN;

    const rowsQuery = applyFilters(
      this.baseQuery(companyId, today),
      filters,
      today,
    )
      .orderBy(sortColumn, filters.sortOrder)
      .orderBy(`${DOCUMENTS_TABLE}.id`, "asc") // stable tiebreak so pages don't shuffle
      .limit(limit)
      .offset((page - 1) * limit);

    const countQuery = applyFilters(
      knex(DOCUMENTS_TABLE).where(`${DOCUMENTS_TABLE}.companyId`, companyId),
      filters,
      today,
    ).count<{ count: string }[]>("* as count");

    const [rows, countRows] = await Promise.all([
      rowsQuery as unknown as Promise<IJoinedDocumentRow[]>,
      countQuery,
    ]);

    return {
      rows: rows.map((row) => ({
        id: row.id,
        document: toCountdownDocument(row),
      })),
      totalCount: toCountOut(countRows[0]?.count),
    };
  }

  /** Every matching row, for the export. Capped; the caller reports truncation. */
  async listAll(
    companyId: number,
    filters: ICountdownDocumentFilters,
    today: string,
  ): Promise<ICountdownDocumentEntry[]> {
    const sortColumn =
      (filters.sortBy && SORT_ALLOWLIST[filters.sortBy]) ?? DEFAULT_SORT_COLUMN;

    const rows = (await applyFilters(
      this.baseQuery(companyId, today),
      filters,
      today,
    )
      .orderBy(sortColumn, filters.sortOrder)
      .orderBy(`${DOCUMENTS_TABLE}.id`, "asc")
      .limit(COUNTDOWN_EXPORT_ROW_CAP)) as unknown as IJoinedDocumentRow[];

    return rows.map((row) => ({
      id: row.id,
      document: toCountdownDocument(row),
    }));
  }

  async findByUuid(
    uuid: string,
    companyId: number,
    today: string,
  ): Promise<ICountdownDocumentEntry | undefined> {
    const row = (await this.baseQuery(companyId, today)
      .where(`${DOCUMENTS_TABLE}.uuid`, uuid)
      .first()) as IJoinedDocumentRow | undefined;
    return row ? { id: row.id, document: toCountdownDocument(row) } : undefined;
  }

  /** Explicit id resolution (L-005): never `if (!row.id)` after a stripping mapper. */
  async getIdByUuid(
    uuid: string,
    companyId: number,
  ): Promise<number | undefined> {
    const knex = db("countdown");
    const row = await knex(DOCUMENTS_TABLE)
      .select("id")
      .where({ uuid, companyId })
      .first();
    return row?.id;
  }

  async getRowByUuid(
    uuid: string,
    companyId: number,
  ): Promise<ICountdownDocumentRow | undefined> {
    const knex = db("countdown");
    return knex<ICountdownDocumentRow>(DOCUMENTS_TABLE)
      .where({ uuid, companyId })
      .first();
  }

  /** The uuid is generated by the controller (host rule), not by the DB default. */
  async create(
    uuid: string,
    input: ICountdownDocumentWriteInput,
    trx?: Knex.Transaction,
  ): Promise<string> {
    const knex = db("countdown");
    const rows = await (trx ?? knex)(DOCUMENTS_TABLE)
      .insert({ ...input, uuid })
      .returning("uuid");
    const created = rows[0];
    if (!created)
      throw new Error("[CountdownDocumentDAO] insert returned no row");
    return created.uuid;
  }

  async update(
    id: number,
    companyId: number,
    patch: Partial<
      Pick<
        ICountdownDocumentRow,
        | "title"
        | "issuer"
        | "referenceNumber"
        | "categoryId"
        | "subcategoryId"
        | "notes"
        | "amountCents"
        | "currency"
        | "dueDate"
        | "recurrenceCount"
        | "recurrenceUnit"
        | "reminderDays"
      >
    >,
  ): Promise<void> {
    const knex = db("countdown");
    await knex(DOCUMENTS_TABLE)
      .where({ id, companyId })
      .update({ ...patch, updatedAt: knex.fn.now() });
  }

  async setStatus(
    id: number,
    companyId: number,
    status: CountdownDocumentStatus,
    resolvedBy: number | null,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const knex = db("countdown");
    const executor = trx ?? knex;
    await executor(DOCUMENTS_TABLE)
      .where({ id, companyId })
      .update({
        status,
        resolvedAt: status === "resolved" ? executor.fn.now() : null,
        resolvedBy: status === "resolved" ? resolvedBy : null,
        updatedAt: executor.fn.now(),
      });
  }

  async delete(id: number, companyId: number): Promise<boolean> {
    const knex = db("countdown");
    const deleted = await knex(DOCUMENTS_TABLE)
      .where({ id, companyId })
      .delete();
    return deleted > 0;
  }

  /**
   * Dashboard counters in one round trip. Every "today" is the same bound
   * parameter, so the eight numbers can never be computed against two different
   * days (which is what `current_date` under a UTC session would have done a few
   * hours a day for a Buenos Aires customer).
   */
  async summary(
    companyId: number,
    today: string,
  ): Promise<ICountdownDocumentSummary> {
    const knex = db("countdown");
    const result = await knex.raw(
      `
      select
        count(*) filter (where status = 'pending')                                  as "pendingCount",
        count(*) filter (where status = 'pending' and "dueDate" < ?::date)          as "overdueCount",
        count(*) filter (where status = 'pending' and "dueDate" = ?::date)          as "dueTodayCount",
        count(*) filter (where status = 'pending' and "dueDate" > ?::date
                                                  and "dueDate" <= ?::date + 7)     as "dueIn7Count",
        count(*) filter (where status = 'pending' and "dueDate" > ?::date
                                                  and "dueDate" <= ?::date + 30)    as "dueIn30Count",
        count(*) filter (where status = 'resolved')                                 as "resolvedCount",
        coalesce(sum("amountCents") filter (where status = 'pending'), 0)           as "pendingAmountCents",
        coalesce(sum("amountCents") filter (where status = 'pending'
                                              and "dueDate" < ?::date), 0)          as "overdueAmountCents"
      from ${DOCUMENTS_TABLE}
      where "companyId" = ?
    `,
      [today, today, today, today, today, today, today, companyId],
    );

    const row = (result.rows as Record<string, unknown>[])[0];
    return {
      pendingCount: toCountOut(row?.pendingCount),
      overdueCount: toCountOut(row?.overdueCount),
      dueTodayCount: toCountOut(row?.dueTodayCount),
      dueIn7Count: toCountOut(row?.dueIn7Count),
      dueIn30Count: toCountOut(row?.dueIn30Count),
      resolvedCount: toCountOut(row?.resolvedCount),
      pendingAmountCents: toCountOut(row?.pendingAmountCents),
      overdueAmountCents: toCountOut(row?.overdueAmountCents),
    };
  }
}
