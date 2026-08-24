import { db } from "../database/registry";

/**
 * Shared code generator (Procusto autonumerador framework replacement — spec:
 * modules/01-system-and-cross-cutting/autonumeradores.md).
 *
 * Output formats preserve Procusto's exactly (parity golden tests):
 *   production-order (global fallback): 8-digit zero-padded  → "00000001"
 *   production-order per pedido:        "{pedido}\{n}" (unpadded, starts at 1)
 *   coil (bobina):                      10-digit zero-padded → "0000000001"
 *
 * Counters live in code_sequences under SELECT … FOR UPDATE (divergence D7 —
 * concurrency-safe, replacing the racy max-scan). Only 5 generators are
 * registered live in Procusto; entity wiring happens as those modules land.
 */

export const CODE_SCOPES = {
  productionOrder: "production-order",
  coil: "coil",
  sheetLot: "sheet-lot",
  finishedGoodStock: "finished-good-stock",
  salesOrder: "sales-order",
} as const;

const PAD_WIDTHS: Record<string, number> = {
  [CODE_SCOPES.productionOrder]: 8,
  [CODE_SCOPES.coil]: 10,
  // pedido `Numero`: 8-digit zero-padded, same format as Procusto's
  // `{0:00000000}` (Editar.cs:54-65) — only the counter source diverges (D-5).
  [CODE_SCOPES.salesOrder]: 8,
  // sheet-lot / finished-good-stock formats to be pinned when modules 10/11 land.
  [CODE_SCOPES.sheetLot]: 0,
  [CODE_SCOPES.finishedGoodStock]: 0,
};

/** Zero-pad per Procusto's pad_left(n, WIDTH, '0'); width 0 = unpadded. */
export function formatCode(value: number, width: number): string {
  const s = String(value);
  return width > 0 ? s.padStart(width, "0") : s;
}

/** Dependent-order format: `{parent}\{n}` — backslash, unpadded suffix. */
export function formatDependentCode(parentCode: string, value: number): string {
  return `${parentCode}\\${value}`;
}

/** Extract the numeric suffix of a dependent code (regex `(.*)\\(.*)`), or null. */
export function parseDependentSuffix(code: string): number | null {
  const match = /^(.*)\\(.*)$/.exec(code);
  if (!match) return null;
  const n = parseInt(match[2], 10);
  return Number.isNaN(n) ? null : n;
}

export class CodeGeneratorService {
  /**
   * Atomically advance the (company, scope, parentKey) counter and return the
   * formatted next code.
   */
  async next(
    companyId: number,
    scope: string,
    parentKey: string | null = null,
  ): Promise<string> {
    const value = await this.nextValue(companyId, scope, parentKey);
    if (parentKey !== null) return formatDependentCode(parentKey, value);
    return formatCode(value, PAD_WIDTHS[scope] ?? 0);
  }

  /**
   * The raw incremented counter value (for callers with custom formatting).
   * Single atomic upsert — safe under concurrency with no row-lock dance and
   * no aborted-transaction recovery path.
   */
  async nextValue(
    companyId: number,
    scope: string,
    parentKey: string | null = null,
  ): Promise<number> {
    const knex = db("erp");
    const [row] = await knex("code_sequences")
      .insert({ companyId, scope, parentKey: parentKey ?? "", lastValue: 1 })
      .onConflict(["companyId", "scope", "parentKey"])
      .merge({
        lastValue: knex.raw('"code_sequences"."lastValue" + 1'),
        updatedAt: knex.fn.now(),
      })
      .returning("lastValue");
    return Number((row as any).lastValue ?? row);
  }

  /**
   * Seed a counter (ETL: lastValue = MAX(existing numeric value/suffix)).
   * Never lowers an existing counter.
   */
  async seed(
    companyId: number,
    scope: string,
    parentKey: string | null,
    lastValue: number,
  ): Promise<void> {
    const knex = db("erp");
    await knex("code_sequences")
      .insert({ companyId, scope, parentKey: parentKey ?? "", lastValue })
      .onConflict(["companyId", "scope", "parentKey"])
      .merge({
        lastValue: knex.raw('GREATEST("code_sequences"."lastValue", ?)', [
          lastValue,
        ]),
        updatedAt: knex.fn.now(),
      });
  }
}
