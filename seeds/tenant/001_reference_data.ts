import type { Knex } from "knex";

/**
 * Reference data a fresh tenant would need (model U-3: `app_config`,
 * `code_sequences`, `*_types`) — resolved empirically rather than assumed
 * (T9/D-1, see decisions.md): on local `traffic_production`, a plain company
 * created through the API today has ZERO rows in every one of those tables.
 * `AppConfigService` resolves an absent key to its in-code default without
 * ever writing a row (`app-config.service.ts`), and `CodeGeneratorService`
 * upserts a `code_sequences` row lazily on first use
 * (`code-generator.service.ts`) — neither is pre-seeded anywhere today. The
 * `*_types` tables hold real catalogue rows only for the QA demo seed company
 * (`seeds/core/002_qa_demo_co.ts`), never for a company created the ordinary
 * way (company 1, "Acme Cajas", has none). So the C1 baseline AC-53 checks a
 * provisioned tenant against is zero rows in all three families, and this
 * file ships empty rather than inventing catalogue data no company gets
 * today (T9's provisioning step still runs it, on every provision, so it
 * stays the single place to add real defaults if that ever changes).
 */
export async function seed(_knex: Knex): Promise<void> {
  // Intentionally empty — see the file comment above.
}
