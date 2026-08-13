import type { Knex } from "knex";
import { MAX_DNS_LABEL_LENGTH } from "../src/utils/slugify";

/**
 * `modules.publicDomainLabel` — the hostname label a module's customer-facing
 * app lives at: `{company.slug}.{publicDomainLabel}.mobiusboxing.com`
 * (D-1). It is deliberately NOT the module slug: `countdown` is served from
 * `vencimientos`, and assuming they match produces a URL nobody can reach.
 *
 * Nullable, because most modules have no public surface at all (`core`,
 * `store`): NULL means "this module shows no URL". UNIQUE so two modules can
 * never claim the same hostname — Postgres allows any number of NULLs under a
 * UNIQUE constraint, so the nullable + unique combination is exactly right here.
 *
 * varchar(63) for the same reason as `companies.slug`: the column IS a single
 * DNS label (RFC 1035 §2.3.4).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("modules", (table) => {
    table.string("publicDomainLabel", MAX_DNS_LABEL_LENGTH).nullable();
    table.unique(["publicDomainLabel"]);
  });

  // Idempotent seed: only fills the label in when nobody has set one, so
  // re-running (or a manual correction made in production) is never clobbered.
  await knex.raw(
    `UPDATE modules
        SET "publicDomainLabel" = 'vencimientos', "updatedAt" = NOW()
      WHERE slug = 'countdown' AND "publicDomainLabel" IS NULL`,
  );
}

/** Dev only — production is roll-forward (L-003). */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("modules", (table) => {
    table.dropColumn("publicDomainLabel");
  });
}
