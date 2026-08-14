import { db } from "../../database/registry";
import { IModule } from "../../interfaces/module/module.interfaces";

export class ModuleDAO {
  private tableName = "modules";

  /** List every module in the catalog. Static catalog, no pagination needed. */
  async getAll(): Promise<IModule[]> {
    const knex = db("core");
    const records = await knex(this.tableName).select("*").orderBy("id", "asc");
    return records.map((record) => this.mapToInterface(record));
  }

  /** Lookup by slug — used by backoffice toggle endpoints (slug is the public key). */
  async getBySlug(slug: string): Promise<IModule | null> {
    const knex = db("core");
    const record = await knex(this.tableName).where("slug", slug).first();
    return record ? this.mapToInterface(record) : null;
  }

  /** Lookup by primary key — used internally (e.g., joins, FK resolution). */
  async getById(id: number): Promise<IModule | null> {
    const knex = db("core");
    const record = await knex(this.tableName).where("id", id).first();
    return record ? this.mapToInterface(record) : null;
  }

  private mapToInterface(record: any): IModule {
    return {
      id: record.id,
      uuid: record.uuid,
      slug: record.slug,
      name: record.name,
      description: record.description ?? null,
      isCore: record.isCore,
      publicDomainLabel: record.publicDomainLabel ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
