import type { Knex } from "knex";

// List ORDER BYs on text columns use this collation (queryBuilder NATURAL_COLLATION).
// The databases' en_US.utf8 libc collation sorts as plain byte order on the Alpine
// postgres image ("Zeta" < "alpha", "Álvarez" after "z", "1079" < "12"); ICU Spanish
// with numeric digit runs ("kn") gives a < A < Álvarez < b, n < ñ < o, 9 < 10 < 1079.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    "CREATE COLLATION IF NOT EXISTS mobius_natural (provider = icu, locale = 'es-u-kn')",
  );
}

export async function down(): Promise<void> {
  throw new Error("roll-forward only (L-003) — restore from a dump instead");
}
