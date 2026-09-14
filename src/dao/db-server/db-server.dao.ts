import { Request } from "express";
import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import { IDbServer } from "../../interfaces/tenant/tenant.interfaces";
import {
  parseQueryParams,
  buildQuery,
  buildCountQuery,
  createQueryConfig,
  type QueryBuilderConfig,
  type FilterConfigs,
  type SortConfigs,
} from "../../utils/queryBuilder";

const TABLE = "db_servers";

/** `GET /api/db-servers` list item (model): the row plus two computed fields. */
export interface IDbServerListItem extends IDbServer {
  tenantCount: number;
  provisionable: boolean;
}

export interface IDbServerCreateInput {
  uuid: string;
  name: string;
  kind: IDbServer["kind"];
  host: string | null;
  port: number | null;
  sslMode: IDbServer["sslMode"];
  adminUser: string | null;
  adminCredentialRef: string | null;
  connectionBudget: number;
  isDefaultPlacement: boolean;
}

/** `POST /api/db-servers`, brief AC-61: `name` is unique (D-70-adjacent) and at most one row may hold `isDefaultPlacement`. */
export class DbServerNameTakenError extends Error {
  constructor(name: string) {
    super(`db_servers.name "${name}" is already taken`);
    this.name = "DbServerNameTakenError";
  }
}
export class DbServerDefaultPlacementExistsError extends Error {
  constructor() {
    super("a db_servers row already has isDefaultPlacement = true");
    this.name = "DbServerDefaultPlacementExistsError";
  }
}

const DB_SERVER_FILTERS: FilterConfigs = {
  kind: { column: "kind", operator: "=" },
  status: { column: "status", operator: "=" },
};

const DB_SERVER_SORTING: SortConfigs = {
  name: { column: "name" },
  createdAt: { column: "createdAt" },
  updatedAt: { column: "updatedAt" },
};

const DB_SERVER_QUERY_CONFIG: QueryBuilderConfig = createQueryConfig(
  TABLE,
  {
    filters: DB_SERVER_FILTERS,
    sorting: DB_SERVER_SORTING,
    defaultSort: { column: "id", order: "asc" },
  },
);

/** `tenant_databases` rows counted against a server, model I-1's live set. */
const LIVE_STATUSES_SQL =
  "'active','suspended','decommissioning'";

/**
 * Where databases can be placed (db-per-company T6, model D-7; T9/D-58: the
 * write path — `create`/`updateStatus` — is T10's, per that track's own
 * scoping note).
 */
export class DbServerDAO {
  async getById(id: number): Promise<IDbServer | null> {
    const row = await db("core")(TABLE).where("id", id).first();
    return row ? this.mapToInterface(row) : null;
  }

  async getByUuid(uuid: string): Promise<IDbServer | null> {
    const row = await db("core")(TABLE).where("uuid", uuid).first();
    return row ? this.mapToInterface(row) : null;
  }

  async getByName(name: string): Promise<IDbServer | null> {
    const row = await db("core")(TABLE).where("name", name).first();
    return row ? this.mapToInterface(row) : null;
  }

  /** D-32/AC-36: the env-relative row the registry migration seeds. */
  async getDefaultPlacement(): Promise<IDbServer | null> {
    const row = await db("core")(TABLE)
      .where("isDefaultPlacement", true)
      .first();
    return row ? this.mapToInterface(row) : null;
  }

  async listAll(): Promise<IDbServer[]> {
    const rows = await db("core")(TABLE).select("*").orderBy("id", "asc");
    return rows.map((row) => this.mapToInterface(row));
  }

  /** `GET /api/db-servers` (model, brief AC-61): unwrapped `IDataPaginator`, `kind`/`status` filters. */
  async getAllWithFilters(req: Request): Promise<IDataPaginator<IDbServerListItem>> {
    const knex = db("core");
    const parsedQuery = parseQueryParams(req);

    const tenantCountSql = knex.raw(
      `(select count(*)::int from tenant_databases td where td."serverId" = "${TABLE}"."id" and td.status in (${LIVE_STATUSES_SQL})) as "tenantCount"`,
    );
    const dataQuery = knex(TABLE).select(`${TABLE}.*`, tenantCountSql);
    buildQuery(dataQuery, parsedQuery, DB_SERVER_QUERY_CONFIG);

    const countQuery = knex(TABLE);
    buildCountQuery(countQuery, parsedQuery, DB_SERVER_QUERY_CONFIG);

    const [rows, totalResult] = await Promise.all([
      dataQuery,
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: rows.map((row) => this.mapToListItem(row)),
      page: parsedQuery.page,
      limit: parsedQuery.limit,
      count: rows.length,
      totalCount,
      totalPages: Math.ceil(totalCount / parsedQuery.limit),
    };
  }

  /**
   * `POST /api/db-servers` (model). Pre-checked (not just caught) so the two
   * failure codes stay distinct even under `DEBUG_ERRORS=false` — the generic
   * `error.middleware.ts` 23505 handler collapses every unique violation to
   * one `DUPLICATE_ENTRY` code, which is not what AC-61 asks for.
   */
  async create(input: IDbServerCreateInput): Promise<IDbServer> {
    const nameTaken = await this.getByName(input.name);
    if (nameTaken) throw new DbServerNameTakenError(input.name);
    if (input.isDefaultPlacement) {
      const existingDefault = await this.getDefaultPlacement();
      if (existingDefault) throw new DbServerDefaultPlacementExistsError();
    }

    const knex = db("core");
    try {
      const [row] = await knex(TABLE)
        .insert({
          uuid: input.uuid,
          name: input.name,
          kind: input.kind,
          host: input.host,
          port: input.port,
          sslMode: input.sslMode,
          adminUser: input.adminUser,
          adminCredentialRef: input.adminCredentialRef,
          connectionBudget: input.connectionBudget,
          isDefaultPlacement: input.isDefaultPlacement,
        })
        .returning("*");
      return this.mapToInterface(row);
    } catch (error: any) {
      // Race-safety net for the pre-checks above (TOCTOU): a concurrent insert
      // between the check and this statement still lands on the right code.
      if (error?.code === "23505") {
        if (error.constraint === "db_servers_default_uidx") {
          throw new DbServerDefaultPlacementExistsError();
        }
        throw new DbServerNameTakenError(input.name);
      }
      throw error;
    }
  }

  /** `PATCH /api/db-servers/:uuid` (model, T10/D-50): the only status this feature writes here is `draining`. */
  async updateStatus(
    uuid: string,
    status: IDbServer["status"],
  ): Promise<IDbServer | null> {
    const knex = db("core");
    const [row] = await knex(TABLE)
      .where("uuid", uuid)
      .update({ status, updatedAt: knex.fn.now() })
      .returning("*");
    return row ? this.mapToInterface(row) : null;
  }

  private mapToListItem(row: Record<string, unknown>): IDbServerListItem {
    return {
      ...this.mapToInterface(row),
      tenantCount: (row.tenantCount as number) ?? 0,
      provisionable: row.adminUser !== null && row.adminUser !== undefined,
    };
  }

  private mapToInterface(row: Record<string, unknown>): IDbServer {
    return {
      id: row.id as number,
      uuid: row.uuid as string,
      name: row.name as string,
      kind: row.kind as IDbServer["kind"],
      host: (row.host as string | null) ?? null,
      port: (row.port as number | null) ?? null,
      sslMode: row.sslMode as IDbServer["sslMode"],
      adminUser: (row.adminUser as string | null) ?? null,
      adminCredentialRef: (row.adminCredentialRef as string | null) ?? null,
      adminCredentialCiphertext:
        (row.adminCredentialCiphertext as Buffer | null) ?? null,
      connectionBudget: row.connectionBudget as number,
      isDefaultPlacement: row.isDefaultPlacement as boolean,
      status: row.status as IDbServer["status"],
      createdAt: row.createdAt as Date,
      updatedAt: row.updatedAt as Date,
    };
  }
}
