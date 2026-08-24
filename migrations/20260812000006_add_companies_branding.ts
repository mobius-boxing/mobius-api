import type { Knex } from "knex";
import {
  isEmptyBranding,
  readLegacyModuleBranding,
} from "../src/utils/whitelabel-branding";
import { ICompanyBranding } from "../src/interfaces/company/company.interfaces";

/**
 * `companies.branding` — the single home of a client's whitelabel identity
 * (D-2: branding belongs to the company, not to one of its modules).
 *
 * Same column style as `company_modules.config`: jsonb NOT NULL DEFAULT '{}',
 * so every existing row keeps reading fine and nothing has to handle NULL.
 *
 * The backfill copies the LEGACY location — `company_modules.config.<slug>.branding`,
 * written by `PUT /api/companies/:uuid/modules/:slug/config` — into the new
 * column, using the same reader the public endpoint uses (`readLegacyModuleBranding`)
 * so the migrated value can never differ from what the endpoint would have served.
 *
 * Deliberately additive and re-runnable:
 *  - the legacy `config.<slug>.branding` keys are LEFT IN PLACE, just unread.
 *    No destructive write ever touches live tenant data;
 *  - only companies whose `branding` is still `{}` are written, so a manual
 *    correction made after this migration is never clobbered.
 *
 * Ordering is deterministic (companyId, module id) so the same database always
 * produces the same result: where two modules of one company disagree, the
 * first by module id wins and the loser is logged (AC-18).
 *
 * L-003: `down()` exists for dev only — production is roll-forward.
 */

interface LegacyRow {
  companyId: number;
  slug: string;
  config: unknown;
}

/** Two brandings disagree when any of the four fields differs. */
const differs = (a: ICompanyBranding, b: ICompanyBranding): boolean =>
  a.displayName !== b.displayName ||
  a.brandColor !== b.brandColor ||
  a.logoFileUuid !== b.logoFileUuid ||
  a.loginMessage !== b.loginMessage;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("companies", (table) => {
    table.jsonb("branding").notNullable().defaultTo("{}");
  });

  const rows: LegacyRow[] = await knex("company_modules as cm")
    .join("modules as m", "m.id", "cm.moduleId")
    .select(
      "cm.companyId as companyId",
      "m.slug as slug",
      "cm.config as config",
    )
    .orderBy([
      { column: "cm.companyId", order: "asc" },
      { column: "m.id", order: "asc" },
    ]);

  const winners = new Map<
    number,
    { slug: string; branding: ICompanyBranding }
  >();

  for (const row of rows) {
    const branding = readLegacyModuleBranding(row.config, row.slug);
    if (isEmptyBranding(branding)) continue;

    const winner = winners.get(row.companyId);
    if (!winner) {
      winners.set(row.companyId, { slug: row.slug, branding });
      continue;
    }
    if (differs(winner.branding, branding)) {
      // Not an error: one of the two has to win, and the choice is recorded so
      // a human can re-`PUT` the right one from the backoffice afterwards.
      console.log(
        `[migration 20260812000006] branding collision for companyId=${row.companyId}: ` +
          `keeping "${winner.slug}", ignoring "${row.slug}"`,
      );
    }
  }

  for (const [companyId, winner] of winners) {
    await knex("companies")
      .where("id", companyId)
      // Never overwrite branding that is already there (re-run safety).
      .andWhereRaw(`COALESCE("branding", '{}'::jsonb) = '{}'::jsonb`)
      // Explicit stringify for the jsonb column (same as CompanyModuleDAO.updateConfig) —
      // never rely on the driver guessing the parameter type.
      .update({
        branding: JSON.stringify(winner.branding),
        updatedAt: knex.fn.now(),
      });
  }
}

/** Dev only — production is roll-forward (L-003). */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("companies", (table) => {
    table.dropColumn("branding");
  });
}
