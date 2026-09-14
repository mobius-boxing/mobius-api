/**
 * The tenant registry (db-per-company T6, model D-7): where a company's
 * database lives (`db_servers`, `tenant_databases`) and what happened to it
 * (`tenant_migration_runs`). All three are `core`-plane tables.
 *
 * These are 1:1 DAO-level projections of the tables, ciphertext columns
 * included as `Buffer | null` — the row shape the DAO returns. A future API
 * mapper (T7+) strips `dbUser`/`credentialRef`/`*Ciphertext`/`host` before
 * anything here reaches an endpoint (model I-6); no such mapper exists yet
 * because T6 ships no route.
 */

export const DB_SERVER_KINDS = ["shared_container", "rds", "external"] as const;
export type DbServerKind = (typeof DB_SERVER_KINDS)[number];

export const DB_SERVER_SSL_MODES = [
  "disable",
  "require",
  "verify-full",
] as const;
export type DbServerSslMode = (typeof DB_SERVER_SSL_MODES)[number];

export const DB_SERVER_STATUSES = ["active", "draining", "retired"] as const;
export type DbServerStatus = (typeof DB_SERVER_STATUSES)[number];

export interface IDbServer {
  id: number;
  uuid: string;
  name: string;
  kind: DbServerKind;
  host: string | null;
  port: number | null;
  sslMode: DbServerSslMode;
  adminUser: string | null;
  adminCredentialRef: string | null;
  adminCredentialCiphertext: Buffer | null;
  connectionBudget: number;
  isDefaultPlacement: boolean;
  status: DbServerStatus;
  createdAt: Date;
  updatedAt: Date;
}

export const TENANT_DATABASE_STATUSES = [
  "provisioning",
  "failed",
  "active",
  "suspended",
  "decommissioning",
  "retired",
] as const;
export type TenantDatabaseStatus = (typeof TENANT_DATABASE_STATUSES)[number];

/** The two partial-unique-index groups (model I-1). */
export const TENANT_DATABASE_LIVE_STATUSES: readonly TenantDatabaseStatus[] = [
  "active",
  "suspended",
  "decommissioning",
];
export const TENANT_DATABASE_BUILDING_STATUSES: readonly TenantDatabaseStatus[] =
  ["provisioning", "failed"];

export const MIGRATION_STATES = [
  "unknown",
  "current",
  "behind",
  "running",
  "failed",
] as const;
export type MigrationState = (typeof MIGRATION_STATES)[number];

export interface ITenantDatabase {
  id: number;
  uuid: string;
  companyId: number;
  serverId: number;
  databaseName: string;
  dbUser: string;
  credentialRef: string;
  credentialCiphertext: Buffer | null;
  poolMax: number;
  poolMin: number;
  status: TenantDatabaseStatus;
  schemaVersion: string | null;
  migrationState: MigrationState;
  lastMigrationAt: Date | null;
  lastMigrationError: string | null;
  provisionedAt: Date | null;
  suspendedAt: Date | null;
  suspendReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const MIGRATION_RUN_STATUSES = [
  "running",
  "succeeded",
  "failed",
] as const;
export type MigrationRunStatus = (typeof MIGRATION_RUN_STATUSES)[number];

export interface ITenantMigrationRun {
  id: number;
  uuid: string;
  tenantDatabaseId: number;
  fromVersion: string | null;
  toVersion: string;
  status: MigrationRunStatus;
  triggeredBy: string;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
}
