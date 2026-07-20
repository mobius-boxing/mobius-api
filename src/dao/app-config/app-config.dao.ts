import KnexManager from "../../database/KnexConnection";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import { IAppConfig } from "../../interfaces/app-config/app-config.interfaces";

/**
 * Settings-store DAO. app_config is a keyed store, not a list page — access is
 * by (companyId, key), so the standardized query builder does not apply
 * (NEW_ENTITY_STANDARD exception: non-list endpoint).
 */
export class AppConfigDAO {
  private tableName = "app_config";

  async getAllForCompany(companyId: number): Promise<IAppConfig[]> {
    const knex = KnexManager.getConnection();
    const rows = await knex(this.tableName)
      .where("companyId", companyId)
      .orderBy("key", "asc");
    return rows as IAppConfig[];
  }

  async getByKey(companyId: number, key: string): Promise<IAppConfig | null> {
    const knex = KnexManager.getConnection();
    const row = await knex(this.tableName)
      .where({ companyId, key })
      .first();
    return (row as IAppConfig) ?? null;
  }

  async upsert(
    companyId: number,
    key: string,
    value: string,
    valueType: string,
  ): Promise<IAppConfig> {
    const knex = KnexManager.getConnection();
    const [row] = await knex(this.tableName)
      .insert({ companyId, key, value, valueType })
      .onConflict(["companyId", "key"])
      .merge({ value, valueType, updatedAt: knex.fn.now() })
      .returning("*");
    return row as IAppConfig;
  }

  /** Remove the override so the key falls back to its default. */
  async deleteByKey(companyId: number, key: string): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where({ companyId, key }).delete();
    return deleted > 0;
  }

  /** Resolve a company UUID (as carried by the JWT) to its numeric id. */
  async resolveCompanyId(companyUuid: string): Promise<number | null> {
    return getIdByUuid(companyUuid, "companies");
  }
}
