import type { Knex } from "knex";

/**
 * Give node-files its public domain label so each customer gets
 * `{companies.slug}.flujos.mobiusboxing.com`.
 *
 * Label ≠ slug, deliberately, and this is the second instance of that rule:
 * countdown's slug is `countdown` but it is served from `vencimientos` so the
 * legacy standalone Countdown app keeps `countdown.mobiusboxing.com`. Here the
 * slug stays `node-files` (route path, permission code, npm package) while the
 * customer-facing label is `flujos`, matching the module's own vocabulary —
 * its nav reads Flujos / Ejecuciones.
 *
 * Nothing else needs to change to onboard a customer: the whitelabel endpoint
 * is generic over `:module`, and `publicDomainLabel` is what the backoffice
 * uses to compose the URL it shows. Adding a tenant is a slug + an enablement
 * + branding — DNS-free and rebuild-free, per docs/infra.md.
 */
export async function up(knex: Knex): Promise<void> {
  await knex("modules")
    .where({ slug: "node-files" })
    .update({ publicDomainLabel: "flujos" });
}

export async function down(knex: Knex): Promise<void> {
  await knex("modules")
    .where({ slug: "node-files" })
    .update({ publicDomainLabel: null });
}
