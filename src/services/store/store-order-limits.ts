import { CompanyModuleDAO } from "../../dao/company-module/company-module.dao";

/**
 * Order limits for a company's store module.
 *
 * Only the two unambiguous rules are enforced in v1:
 *   - maxBoxMeasures:          max distinct box measures (sourceUuids) per order.
 *   - minPalletsPerBoxMeasure: each box line must be >= this many pallets
 *                              (i.e. quantity >= minPalletsPerBoxMeasure * unitsPerPallet).
 *
 * maxTotalBoxUnits is intentionally optional and NOT populated by v1 config — it exists so
 * the ambiguous "5000/6000 unit cap" (store.md §5) can become data-driven later WITHOUT
 * touching the controller. The controller only enforces it when present.
 */
export interface StoreOrderLimits {
  maxBoxMeasures: number;
  minPalletsPerBoxMeasure: number;
  // TODO(store-limits): max total box units cap — store.md §5 is ambiguous/overlapping;
  // confirm with customer before enforcing. When the field appears in company_modules.config
  // (config.store.storeOrderLimits.maxTotalBoxUnits) it will flow through here automatically.
  maxTotalBoxUnits?: number;
}

const DEFAULT_LIMITS: StoreOrderLimits = {
  maxBoxMeasures: 8,
  minPalletsPerBoxMeasure: 2,
};

/**
 * Resolve effective store-order limits for a company. Reads the `store` module's
 * config (company_modules.config.store.storeOrderLimits) and overlays it on the
 * defaults. In v1 config is typically `{}`, so this returns defaults — the lookup
 * exists so limits become data-driven later without controller changes.
 *
 * Fail-soft: any read/shape error falls back to defaults (never blocks order creation).
 */
export async function getStoreOrderLimits(
  companyId: number,
): Promise<StoreOrderLimits> {
  try {
    const modules = await new CompanyModuleDAO().getByCompany(companyId);
    const storeModule = modules.find((m) => m.slug === "store");
    const config = (storeModule?.config ?? {}) as Record<string, unknown>;

    // config.store.storeOrderLimits — forward-compatible nested shape.
    const storeSection = (config.store ?? {}) as Record<string, unknown>;
    const limits = (storeSection.storeOrderLimits ?? {}) as Record<
      string,
      unknown
    >;

    const result: StoreOrderLimits = { ...DEFAULT_LIMITS };

    if (
      typeof limits.maxBoxMeasures === "number" &&
      Number.isInteger(limits.maxBoxMeasures) &&
      limits.maxBoxMeasures > 0
    ) {
      result.maxBoxMeasures = limits.maxBoxMeasures;
    }
    if (
      typeof limits.minPalletsPerBoxMeasure === "number" &&
      Number.isInteger(limits.minPalletsPerBoxMeasure) &&
      limits.minPalletsPerBoxMeasure > 0
    ) {
      result.minPalletsPerBoxMeasure = limits.minPalletsPerBoxMeasure;
    }
    if (
      typeof limits.maxTotalBoxUnits === "number" &&
      Number.isInteger(limits.maxTotalBoxUnits) &&
      limits.maxTotalBoxUnits > 0
    ) {
      result.maxTotalBoxUnits = limits.maxTotalBoxUnits;
    }

    return result;
  } catch (err) {
    console.error("getStoreOrderLimits failed; using defaults:", err);
    return { ...DEFAULT_LIMITS };
  }
}
