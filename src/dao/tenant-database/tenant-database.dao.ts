import { db } from "../../database/registry";
import {
  ITenantDatabase,
  ITenantMigrationRun,
  MigrationRunStatus,
  TENANT_DATABASE_BUILDING_STATUSES,
  TENANT_DATABASE_LIVE_STATUSES,
  TenantDatabaseStatus,
} from "../../interfaces/tenant/tenant.interfaces";

const TABLE = "tenant_databases";
const RUNS_TABLE = "tenant_migration_runs";

/**
 * `tenant_databases.status` changes only through this table (model I-8) — a
 * single-row compare-and-set. The two-row flip (`tenant:move`'s
 * `suspended`+`provisioning` → `retired`+`active`) and the row deletes
 * (`decommissioning`/`retired` → gone) are orchestrated elsewhere (T9): they
 * are not expressible as one row's CAS and are deliberately absent here, so
 * `transition()` never assigns `retired` or removes a row.
 */
export const TENANT_DATABASE_TRANSITIONS: ReadonlyArray<
  readonly [TenantDatabaseStatus, TenantDatabaseStatus]
> = [
  ["provisioning", "active"],
  ["provisioning", "failed"],
  ["failed", "provisioning"],
  ["active", "suspended"],
  ["suspended", "active"],
  ["active", "decommissioning"],
  ["suspended", "decommissioning"],
];

const isAllowedTransition = (
  from: TenantDatabaseStatus,
  to: TenantDatabaseStatus,
): boolean =>
  TENANT_DATABASE_TRANSITIONS.some(([f, t]) => f === from && t === to);

/** A `(from, to)` pair outside the model's transition table (AC-32). */
export class InvalidTenantDatabaseTransitionError extends Error {
  constructor(
    readonly from: TenantDatabaseStatus,
    readonly to: TenantDatabaseStatus,
  ) {
    super(
      `tenant_databases: "${from}" -> "${to}" is not in the model's transition table (I-8)`,
    );
    this.name = "InvalidTenantDatabaseTransitionError";
  }
}

/** Fields a caller may set alongside a transition (model's "side effects" column). */
export type TenantDatabaseTransitionPatch = Partial<
  Pick<
    ITenantDatabase,
    | "schemaVersion"
    | "migrationState"
    | "lastMigrationAt"
    | "lastMigrationError"
    | "provisionedAt"
    | "suspendReason"
  >
>;

export interface ITenantDatabaseCreateInput {
  uuid: string;
  companyId: number;
  serverId: number;
  databaseName: string;
  dbUser: string;
  credentialRef: string;
  credentialCiphertext: Buffer | null;
  poolMax?: number;
  poolMin?: number;
}

export interface IStartMigrationRunInput {
  tenantDatabaseId: number;
  fromVersion: string | null;
  toVersion: string;
  triggeredBy: string;
}

export class TenantDatabaseDAO {
  async getById(id: number): Promise<ITenantDatabase | null> {
    const row = await db("core")(TABLE).where("id", id).first();
    return row ? this.mapToInterface(row) : null;
  }

  async getByUuid(uuid: string): Promise<ITenantDatabase | null> {
    const row = await db("core")(TABLE).where("uuid", uuid).first();
    return row ? this.mapToInterface(row) : null;
  }

  /** Model I-1: the single live row for a company, if any. */
  async getLiveByCompanyId(companyId: number): Promise<ITenantDatabase | null> {
    const row = await db("core")(TABLE)
      .where("companyId", companyId)
      .whereIn("status", TENANT_DATABASE_LIVE_STATUSES)
      .first();
    return row ? this.mapToInterface(row) : null;
  }

  /** The in-flight build row for a company, if any. */
  async getBuildingByCompanyId(
    companyId: number,
  ): Promise<ITenantDatabase | null> {
    const row = await db("core")(TABLE)
      .where("companyId", companyId)
      .whereIn("status", TENANT_DATABASE_BUILDING_STATUSES)
      .first();
    return row ? this.mapToInterface(row) : null;
  }

  async create(input: ITenantDatabaseCreateInput): Promise<ITenantDatabase> {
    const [row] = await db("core")(TABLE)
      .insert({
        uuid: input.uuid,
        companyId: input.companyId,
        serverId: input.serverId,
        databaseName: input.databaseName,
        dbUser: input.dbUser,
        credentialRef: input.credentialRef,
        credentialCiphertext: input.credentialCiphertext,
        ...(input.poolMax !== undefined ? { poolMax: input.poolMax } : {}),
        ...(input.poolMin !== undefined ? { poolMin: input.poolMin } : {}),
      })
      .returning("*");
    return this.mapToInterface(row);
  }

  /** Every row a fleet migration run must visit — live rows only (model D-18). */
  async listForFleetMigration(): Promise<ITenantDatabase[]> {
    const rows = await db("core")(TABLE)
      .whereIn("status", ["active", "suspended"])
      .orderBy("id", "asc");
    return rows.map((row) => this.mapToInterface(row));
  }

  /**
   * Compare-and-set on `status` (model I-8): updates the row only if it still
   * holds `from`, and returns how many rows that touched — 0 means the row
   * moved (or never held `from`) since the caller read it, a race the caller
   * turns into 409, never a silent no-op mistaken for success.
   *
   * `(from, to)` outside `TENANT_DATABASE_TRANSITIONS` throws before any
   * query runs. `suspendedAt` is managed here, not left to `patch`, because it
   * is what the `suspendedAt ⇔ status='suspended'` CHECK enforces — a
   * transition that forgot it would fail at the database instead of silently
   * violating the invariant only because nobody happened to violate it yet.
   */
  async transition(
    id: number,
    from: TenantDatabaseStatus,
    to: TenantDatabaseStatus,
    patch: TenantDatabaseTransitionPatch = {},
  ): Promise<number> {
    if (!isAllowedTransition(from, to)) {
      throw new InvalidTenantDatabaseTransitionError(from, to);
    }
    const knex = db("core");
    const update: Record<string, unknown> = {
      ...patch,
      status: to,
      updatedAt: knex.fn.now(),
    };
    if (to === "suspended") {
      update.suspendedAt = knex.fn.now();
    } else if (from === "suspended") {
      update.suspendedAt = null;
    }

    const updated = await knex(TABLE)
      .where({ id, status: from })
      .update(update)
      .returning("id");
    return updated.length;
  }

  /** D-49: migration-run writes live on this DAO, not a third one. */
  async startMigrationRun(
    input: IStartMigrationRunInput,
  ): Promise<ITenantMigrationRun> {
    const [row] = await db("core")(RUNS_TABLE)
      .insert({
        tenantDatabaseId: input.tenantDatabaseId,
        fromVersion: input.fromVersion,
        toVersion: input.toVersion,
        triggeredBy: input.triggeredBy,
      })
      .returning("*");
    return this.mapRunToInterface(row);
  }

  async finishMigrationRun(
    id: number,
    outcome: {
      status: Extract<MigrationRunStatus, "succeeded" | "failed">;
      error?: string | null;
    },
  ): Promise<number> {
    const knex = db("core");
    const updated = await knex(RUNS_TABLE)
      .where({ id, status: "running" })
      .update({
        status: outcome.status,
        finishedAt: knex.fn.now(),
        error: outcome.error ?? null,
      })
      .returning("id");
    return updated.length;
  }

  async listMigrationRuns(
    tenantDatabaseId: number,
  ): Promise<ITenantMigrationRun[]> {
    const rows = await db("core")(RUNS_TABLE)
      .where("tenantDatabaseId", tenantDatabaseId)
      .orderBy("startedAt", "desc");
    return rows.map((row) => this.mapRunToInterface(row));
  }

  private mapToInterface(row: Record<string, unknown>): ITenantDatabase {
    return {
      id: row.id as number,
      uuid: row.uuid as string,
      companyId: row.companyId as number,
      serverId: row.serverId as number,
      databaseName: row.databaseName as string,
      dbUser: row.dbUser as string,
      credentialRef: row.credentialRef as string,
      credentialCiphertext: (row.credentialCiphertext as Buffer | null) ?? null,
      poolMax: row.poolMax as number,
      poolMin: row.poolMin as number,
      status: row.status as TenantDatabaseStatus,
      schemaVersion: (row.schemaVersion as string | null) ?? null,
      migrationState: row.migrationState as ITenantDatabase["migrationState"],
      lastMigrationAt: (row.lastMigrationAt as Date | null) ?? null,
      lastMigrationError: (row.lastMigrationError as string | null) ?? null,
      provisionedAt: (row.provisionedAt as Date | null) ?? null,
      suspendedAt: (row.suspendedAt as Date | null) ?? null,
      suspendReason: (row.suspendReason as string | null) ?? null,
      createdAt: row.createdAt as Date,
      updatedAt: row.updatedAt as Date,
    };
  }

  private mapRunToInterface(row: Record<string, unknown>): ITenantMigrationRun {
    return {
      id: row.id as number,
      uuid: row.uuid as string,
      tenantDatabaseId: row.tenantDatabaseId as number,
      fromVersion: (row.fromVersion as string | null) ?? null,
      toVersion: row.toVersion as string,
      status: row.status as MigrationRunStatus,
      triggeredBy: row.triggeredBy as string,
      startedAt: row.startedAt as Date,
      finishedAt: (row.finishedAt as Date | null) ?? null,
      error: (row.error as string | null) ?? null,
    };
  }
}
