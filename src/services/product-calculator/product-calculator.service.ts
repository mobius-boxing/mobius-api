/**
 * Product calculations — specs/parts/03-calculations.md + 06-cascade-and-dimensions.md,
 * folded onto `products` (D-1). Moved/renamed from `services/part-calculator`,
 * alongside the rest of the removed-composite-products cleanup.
 *
 * Scope note: with products.modelId still largely unset on live rows, the
 * cascade paths here are:
 *   - internal ↔ external via the corrugation's FIRST flute-type static
 *     adjustments (AjusteLargo/Ancho/Altura → flute_types.length/width/height)
 *   - boxSurface → boxWeight (the ONLY auto-weight path;
 *     PesoEditableEnPartes=False at the live customer → weight computed)
 *
 * Scope = today's 8 cascade fields only (D-11, D-19); CalcularPlancha /
 * CalcularAletas / model formulas are a separate card.
 *
 * All arithmetic in IEEE-754 doubles (parity — 03 gotcha #5).
 */

export interface IFluteAdjustments {
  length: number | null;
  width: number | null;
  height: number | null;
}

export type CascadeField =
  | "boxLength"
  | "boxWidth"
  | "boxHeight"
  | "externalLength"
  | "externalWidth"
  | "externalHeight"
  | "boxSurface"
  | "grammage";

export interface ICalculableProduct {
  boxLength?: number | null;
  boxWidth?: number | null;
  boxHeight?: number | null;
  externalLength?: number | null;
  externalWidth?: number | null;
  externalHeight?: number | null;
  boxSurface?: number | null;
  boxWeight?: number | null;
  grammage?: number | null;
  modelId?: number | null;
}

const AXES = [
  { internal: "boxLength", external: "externalLength", adjust: "length" },
  { internal: "boxWidth", external: "externalWidth", adjust: "width" },
  { internal: "boxHeight", external: "externalHeight", adjust: "height" },
] as const;

export class ProductCalculator {
  /**
   * Effective grammage: product override, else corrugation theoretical
   * (`GramajeTeorico = Producto.Gramaje ?? Corrugado.GramajeTeorico`).
   */
  effectiveGrammage(
    productGrammage: number | null | undefined,
    corrugationTheoretical: number | null | undefined,
  ): number | null {
    return productGrammage ?? corrugationTheoretical ?? null;
  }

  /** SuperficiePlancha = LargoPlancha × AnchoPlancha / 1_000_000 (m²). */
  sheetSurface(
    sheetLength: number | null | undefined,
    sheetWidth: number | null | undefined,
  ): number | null {
    if (sheetLength == null || sheetWidth == null) return null;
    return (sheetLength * sheetWidth) / 1_000_000;
  }

  /** PesoCaja = SuperficieCaja × GramajeTeorico / 1000 (kg). */
  boxWeight(
    boxSurface: number | null | undefined,
    effectiveGrammage: number | null | undefined,
  ): number | null {
    if (
      boxSurface == null ||
      effectiveGrammage == null ||
      effectiveGrammage <= 0
    )
      return null;
    return (boxSurface * effectiveGrammage) / 1000;
  }

  /**
   * Apply one field edit and cascade (06-cascade-and-dimensions.md), mutating
   * and returning the product. `flute` = the corrugation's FIRST flute-type
   * adjustments (Corrugado.TiposDeOnda().First() — only the first is
   * consulted, even for multi-wall). Delta source order: Modelo formula
   * (TODO(module-08)) → flute adjustment → 0 (external == internal).
   */
  applyEdit(
    product: ICalculableProduct,
    field: CascadeField,
    value: number | null,
    flute: IFluteAdjustments | null,
    corrugationTheoreticalGrammage: number | null,
  ): ICalculableProduct {
    const axisByInternal = AXES.find((a) => a.internal === field);
    const axisByExternal = AXES.find((a) => a.external === field);

    if (axisByInternal) {
      // Internal → external: external = internal + delta.
      (product as any)[axisByInternal.internal] = value;
      if (value != null) {
        const delta = flute?.[axisByInternal.adjust] ?? 0;
        (product as any)[axisByInternal.external] = value + delta;
      }
    } else if (axisByExternal) {
      // External → internal (reverse): internal = external - delta.
      (product as any)[axisByExternal.external] = value;
      if (value != null) {
        const delta = flute?.[axisByExternal.adjust] ?? 0;
        (product as any)[axisByExternal.internal] = value - delta;
      }
    } else if (field === "boxSurface") {
      product.boxSurface = value;
      const grammage = this.effectiveGrammage(
        product.grammage,
        corrugationTheoreticalGrammage,
      );
      product.boxWeight = this.boxWeight(value, grammage);
    } else if (field === "grammage") {
      product.grammage = value;
      const grammage = this.effectiveGrammage(
        value,
        corrugationTheoreticalGrammage,
      );
      product.boxWeight = this.boxWeight(product.boxSurface, grammage);
    }

    // TODO(module-08): CalcularAletas + CalcularPlancha when a Modelo is set
    // (sheet dims, trazadores, flap formulas, RotacionObligatoria swap).
    return product;
  }

  /** Batch weight recalc (RecalcularPeso): returns the new weight. */
  recalculateBoxWeight(
    product: ICalculableProduct,
    corrugationTheoreticalGrammage: number | null,
  ): number | null {
    const grammage = this.effectiveGrammage(
      product.grammage,
      corrugationTheoreticalGrammage,
    );
    product.boxWeight = this.boxWeight(product.boxSurface, grammage);
    return product.boxWeight ?? null;
  }
}
