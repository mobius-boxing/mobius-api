import KnexManager from "../database/KnexConnection";

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
} as const;

const PAD_WIDTHS: Record<string, number> = {
  [CODE_SCOPES.productionOrder]: 8,
  [CODE_SCOPES.coil]: 10,
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

  /** The raw incremented counter value (for callers with custom formatting). */
  async nextValue(
    companyId: number,
    scope: string,
    parentKey: string | null = null,
  ): Promise<number> {
    const knex = KnexManager.getConnection();
    return knex.transaction(async (trx) => {
      const base = trx("code_sequences")
        .where({ companyId, scope })
        .modify((q) =>
          parentKey === null
            ? q.whereNull("parentKey")
            : q.where("parentKey", parentKey),
        );

      const row = await base.clone().forUpdate().first();

      if (!row) {
        // First use: create the counter at 1. A concurrent first-insert loses on
        // the unique index and retries via the update path.
        try {
          await trx("code_sequences").insert({
            companyId,
            scope,
            parentKey,
            lastValue: 1,
          });
          return 1;
        } catch (err: any) {
          if (err?.code !== "23505") throw err;
          const existing = await base.clone().forUpdate().first();
          if (!existing) throw err;
          const next = Number(existing.lastValue) + 1;
          await base.clone().update({ lastValue: next, updatedAt: trx.fn.now() });
          return next;
        }
      }

      const next = Number(row.lastValue) + 1;
      await base.clone().update({ lastValue: next, updatedAt: trx.fn.now() });
      return next;
    });
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
    const knex = KnexManager.getConnection();
    await knex.transaction(async (trx) => {
      const base = trx("code_sequences")
        .where({ companyId, scope })
        .modify((q) =>
          parentKey === null
            ? q.whereNull("parentKey")
            : q.where("parentKey", parentKey),
        );
      const row = await base.clone().forUpdate().first();
      if (!row) {
        await trx("code_sequences").insert({ companyId, scope, parentKey, lastValue });
      } else if (Number(row.lastValue) < lastValue) {
        await base.clone().update({ lastValue, updatedAt: trx.fn.now() });
      }
    });
  }
}
