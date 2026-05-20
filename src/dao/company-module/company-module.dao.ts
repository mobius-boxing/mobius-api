import KnexManager from "../../database/KnexConnection";
import {
  ICompanyModuleWithModule,
  SubscriptionStatus,
} from "../../interfaces/company-module/company-module.interfaces";

/** Subscription statuses that block module access. */
const BLOCKED_SUB_STATUSES: SubscriptionStatus[] = ["canceled", "past_due"];

export class CompanyModuleDAO {
  private tableName = "company_modules";

  /**
   * Return EVERY module joined with this company's link row (LEFT JOIN modules → company_modules).
   * Modules with no link row come back with enabled=false and all subscription fields null.
   * Single round trip — no N+1.
   */
  async getByCompany(companyId: number): Promise<ICompanyModuleWithModule[]> {
    const knex = KnexManager.getConnection();
    const records = await knex("modules as m")
      .leftJoin("company_modules as cm", function () {
        this.on("cm.moduleId", "=", "m.id").andOnVal(
          "cm.companyId",
          "=",
          companyId,
        );
      })
      .select(
        "m.id as moduleId",
        "m.uuid as moduleUuid",
        "m.slug",
        "m.name",
        "m.description",
        "m.isCore",
        "cm.id as companyModuleId",
        "cm.enabled",
        "cm.enabledAt",
        "cm.enabledBy",
        "cm.disabledAt",
        "cm.disabledBy",
        "cm.config",
        "cm.subscriptionStatus",
        "cm.trialStartsAt",
        "cm.trialEndsAt",
        "cm.currentPeriodStartsAt",
        "cm.currentPeriodEndsAt",
        "cm.canceledAt",
        "cm.externalSubscriptionId",
      )
      .orderBy("m.id", "asc");
    return records.map((record) => this.mapToWithModule(record));
  }

  /**
   * Slugs of every module enabled AND in a usable subscription state for this company.
   * Used by JWT issuance and /api/auth/me. Single round trip.
   */
  async getEnabledSlugsByCompany(companyId: number): Promise<string[]> {
    const knex = KnexManager.getConnection();
    const slugs = await knex("company_modules as cm")
      .join("modules as m", "m.id", "cm.moduleId")
      .where("cm.companyId", companyId)
      .andWhere("cm.enabled", true)
      .whereNotIn("cm.subscriptionStatus", BLOCKED_SUB_STATUSES)
      .pluck("m.slug");
    return slugs;
  }

  /**
   * Idempotent UPSERT. If no row exists: INSERT enabled=true, subscriptionStatus='comp'.
   * If a row exists (even one previously disabled): flip enabled back on, refresh
   * enabledAt/enabledBy, clear disabledAt/disabledBy. Returns the resulting row
   * joined with module fields (so the controller has everything for the response).
   *
   * Uses ON CONFLICT (companyId, moduleId) DO UPDATE for atomicity — no read-then-write race.
   */
  async enable(
    companyId: number,
    moduleId: number,
    userId: number | null,
  ): Promise<ICompanyModuleWithModule> {
    const knex = KnexManager.getConnection();
    const result = await knex.raw(
      `INSERT INTO company_modules
         ("companyId", "moduleId", enabled, "enabledAt", "enabledBy", "subscriptionStatus")
       VALUES (?, ?, true, NOW(), ?, 'comp')
       ON CONFLICT ("companyId", "moduleId") DO UPDATE
         SET enabled = true,
             "enabledAt" = NOW(),
             "enabledBy" = EXCLUDED."enabledBy",
             "disabledAt" = NULL,
             "disabledBy" = NULL,
             "updatedAt" = NOW()
       RETURNING id`,
      [companyId, moduleId, userId],
    );
    const insertedId: number = result.rows[0].id;
    return this.getJoinedRow(insertedId);
  }

  /**
   * Disable an existing link. Returns null if no link row exists (caller should
   * treat that as a 404 / no-op — disabling something that was never enabled is
   * not an error from the DAO's perspective, but the controller may choose to surface it).
   *
   * Note: blocking the disable of the `core` module is the CONTROLLER's job
   * (uses ModuleDAO.getBySlug → check isCore). Keeping that policy out of the DAO
   * keeps this class dumb and reusable.
   */
  async disable(
    companyId: number,
    moduleId: number,
    userId: number | null,
  ): Promise<ICompanyModuleWithModule | null> {
    const knex = KnexManager.getConnection();
    const updated = await knex(this.tableName)
      .where({ companyId, moduleId })
      .update({
        enabled: false,
        disabledAt: knex.fn.now(),
        disabledBy: userId,
        updatedAt: knex.fn.now(),
      })
      .returning("id");
    if (updated.length === 0) return null;
    return this.getJoinedRow(updated[0].id);
  }

  /**
   * Used by future requireModule middleware AND by /me to confirm a slug is usable.
   * Single round trip — JOIN on modules to filter by slug.
   */
  async isEnabled(companyId: number, slug: string): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const row = await knex("company_modules as cm")
      .join("modules as m", "m.id", "cm.moduleId")
      .where("cm.companyId", companyId)
      .andWhere("m.slug", slug)
      .andWhere("cm.enabled", true)
      .whereNotIn("cm.subscriptionStatus", BLOCKED_SUB_STATUSES)
      .select("cm.id")
      .first();
    return !!row;
  }

  /**
   * Private helper to fetch a fully-joined row by company_modules.id.
   * Used by enable() and disable() to build their return value without a second round trip
   * to construct the joined shape from scratch.
   */
  private async getJoinedRow(
    companyModulesId: number,
  ): Promise<ICompanyModuleWithModule> {
    const knex = KnexManager.getConnection();
    const record = await knex("company_modules as cm")
      .join("modules as m", "m.id", "cm.moduleId")
      .where("cm.id", companyModulesId)
      .select(
        "m.id as moduleId",
        "m.uuid as moduleUuid",
        "m.slug",
        "m.name",
        "m.description",
        "m.isCore",
        "cm.id as companyModuleId",
        "cm.enabled",
        "cm.enabledAt",
        "cm.enabledBy",
        "cm.disabledAt",
        "cm.disabledBy",
        "cm.config",
        "cm.subscriptionStatus",
        "cm.trialStartsAt",
        "cm.trialEndsAt",
        "cm.currentPeriodStartsAt",
        "cm.currentPeriodEndsAt",
        "cm.canceledAt",
        "cm.externalSubscriptionId",
      )
      .first();
    return this.mapToWithModule(record);
  }

  /** Row mapper — handles both the LEFT JOIN case (cm fields possibly null) and the JOIN case. */
  private mapToWithModule(record: any): ICompanyModuleWithModule {
    return {
      moduleId: record.moduleId,
      moduleUuid: record.moduleUuid,
      slug: record.slug,
      name: record.name,
      description: record.description ?? null,
      isCore: record.isCore,

      companyModuleId: record.companyModuleId ?? null,
      enabled: record.enabled ?? false,
      enabledAt: record.enabledAt ?? null,
      enabledBy: record.enabledBy ?? null,
      disabledAt: record.disabledAt ?? null,
      disabledBy: record.disabledBy ?? null,

      config: record.config ?? {},

      subscriptionStatus: record.subscriptionStatus ?? null,
      trialStartsAt: record.trialStartsAt ?? null,
      trialEndsAt: record.trialEndsAt ?? null,
      currentPeriodStartsAt: record.currentPeriodStartsAt ?? null,
      currentPeriodEndsAt: record.currentPeriodEndsAt ?? null,
      canceledAt: record.canceledAt ?? null,
      externalSubscriptionId: record.externalSubscriptionId ?? null,
    };
  }
}
