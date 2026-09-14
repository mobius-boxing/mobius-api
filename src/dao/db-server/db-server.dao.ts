import { db } from "../../database/registry";
import { IDbServer } from "../../interfaces/tenant/tenant.interfaces";

const TABLE = "db_servers";

/**
 * Where databases can be placed (db-per-company T6, model D-7).
 *
 * Read-only for now: the one row this track ships (`shared_container`,
 * D-32) is inserted by its own migration, and adding a second server (an
 * RDS placement) is T9/T10 work — a `create`/PATCH surface would be
 * speculative here and untested by any T6 AC.
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
