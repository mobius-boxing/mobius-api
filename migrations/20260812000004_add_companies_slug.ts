import type { Knex } from "knex";
import {
  MAX_DNS_LABEL_LENGTH,
  RESERVED_DNS_SLUGS,
  toDnsSlug,
} from "../src/utils/slugify";

/**
 * `companies.slug` — the global, DNS-safe client identifier behind whitelabeled
 * hostnames (`{client}.vencimientos.mobiusboxing.com`; modules.md §3 + Q4).
 * One slug per company, shared by every module, so a client is `acme.*`
 * everywhere.
 *
 * varchar(63) because a single DNS label may not exceed 63 octets
 * (RFC 1035 §2.3.4) — the column IS the label, so the limit belongs here and
 * not only in application validation.
 *
 * The column lands nullable, gets backfilled deterministically from `name`
 * (same `toDnsSlug` the DTOs use — one definition, no drift), and only then
 * becomes NOT NULL. The UNIQUE constraint provides the lookup index that
 * `GET /api/public/whitelabel/:module/:client` needs; a second plain index on
 * the same column would be dead weight on every write.
 */

/** Longest numeric suffix we may need to disambiguate ("-999"). */
const MAX_SUFFIX_LENGTH = 4;

/**
 * Fit `base` + `-n` inside the label limit, never leaving a trailing hyphen.
 * Deterministic given the same inputs and the same row ordering.
 */
const withSuffix = (base: string, n: number): string => {
  const suffix = `-${n}`;
  const head = base
    .slice(0, MAX_DNS_LABEL_LENGTH - suffix.length)
    .replace(/-+$/, "");
  return `${head}${suffix}`;
};

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("companies", (table) => {
    table.string("slug", MAX_DNS_LABEL_LENGTH);
  });

  // Ordered by id so the backfill is reproducible: the same database always
  // gets the same slugs, and the "-2" suffix always lands on the newer row.
  const companies: { id: number; name: string | null }[] = await knex(
    "companies",
  )
    .select("id", "name")
    .orderBy("id", "asc");

  // Reserved labels start out "taken": a company literally named "Store" must
  // not claim store.vencimientos.mobiusboxing.com, which is ours.
  const taken = new Set<string>(RESERVED_DNS_SLUGS);

  for (const company of companies) {
    // A company whose name yields nothing usable (symbols only) still needs a
    // slug — fall back to its id, which is unique by construction.
    const base = toDnsSlug(company.name ?? "") || `company-${company.id}`;

    let slug = base;
    let attempt = 1;
    while (taken.has(slug)) {
      attempt += 1;
      slug = withSuffix(base, attempt);
      // Pathological data (thousands of identically-named companies) must not
      // spin forever or overflow the label limit.
      if (attempt > 999) {
        slug = `company-${company.id}`.slice(
          0,
          MAX_DNS_LABEL_LENGTH - MAX_SUFFIX_LENGTH,
        );
        break;
      }
    }
    taken.add(slug);

    await knex("companies").where("id", company.id).update({ slug });
  }

  await knex.schema.alterTable("companies", (table) => {
    table.string("slug", MAX_DNS_LABEL_LENGTH).notNullable().alter();
  });

  // Added after the ALTER: knex's .alter() rebuilds the column definition and
  // would drop a constraint declared beforehand.
  await knex.schema.alterTable("companies", (table) => {
    table.unique(["slug"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("companies", (table) => {
    table.dropColumn("slug");
  });
}
