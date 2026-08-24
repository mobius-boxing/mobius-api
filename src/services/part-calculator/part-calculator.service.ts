/**
 * Part calculations — specs/parts/03-calculations.md + 06-cascade-and-dimensions.md.
 *
 * Scope note: with parts.modelId still unset on live rows, the cascade paths
 * here are:
 *   - internal ↔ external via the corrugation's FIRST flute-type static
 *     adjustments (AjusteLargo/Ancho/Altura → flute_types.length/width/height)
 *   - boxSurface → boxWeight (the ONLY auto-weight path;
 *     PesoEditableEnPartes=False at the live customer → weight computed)
 *
 * Module-08 extension point: the NCalc-parity formula engine is shipped at
 * `src/services/formula-engine/` — consume `evaluate(formula, scope)` for
 * scalar Modelo formulas and `evaluateList(text, scope)` for the pipe-`|`
 * trazadores lists (scope = the 34 FORMULA_PARAMETERS names). Follow-up
 * slices that will consume it from here: CalcularPlancha/CalcularAletas
 * (sheet dims, trazadores from Modelo, flap formulas, AumentoEnFormula
 * Chapeton override), the RotacionObligatoria sheet-swap (golden Fixture C),
 * and POST /models/:uuid/recalculate-parts.
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

export interface ICascadePart {
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

export class PartCalculator {
  /**
   * Effective grammage: Part override, else corrugation theoretical
   * (`GramajeTeorico = Parte.Gramaje ?? Corrugado.GramajeTeorico`).
   */
  effectiveGrammage(
    partGrammage: number | null | undefined,
    corrugationTheoretical: number | null | undefined,
  ): number | null {
    return partGrammage ?? corrugationTheoretical ?? null;
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
   * and returning the part. `flute` = the corrugation's FIRST flute-type
   * adjustments (Corrugado.TiposDeOnda().First() — only the first is
   * consulted, even for multi-wall). Delta source order: Modelo formula
   * (TODO(module-08)) → flute adjustment → 0 (external == internal).
   */
  applyEdit(
    part: ICascadePart,
    field: CascadeField,
    value: number | null,
    flute: IFluteAdjustments | null,
    corrugationTheoreticalGrammage: number | null,
  ): ICascadePart {
    const axisByInternal = AXES.find((a) => a.internal === field);
    const axisByExternal = AXES.find((a) => a.external === field);

    if (axisByInternal) {
      // Internal → external: external = internal + delta.
      (part as any)[axisByInternal.internal] = value;
      if (value != null) {
        const delta = flute?.[axisByInternal.adjust] ?? 0;
        (part as any)[axisByInternal.external] = value + delta;
      }
    } else if (axisByExternal) {
      // External → internal (reverse): internal = external - delta.
      (part as any)[axisByExternal.external] = value;
      if (value != null) {
        const delta = flute?.[axisByExternal.adjust] ?? 0;
        (part as any)[axisByExternal.internal] = value - delta;
      }
    } else if (field === "boxSurface") {
      part.boxSurface = value;
      const grammage = this.effectiveGrammage(
        part.grammage,
        corrugationTheoreticalGrammage,
      );
      part.boxWeight = this.boxWeight(value, grammage);
    } else if (field === "grammage") {
      part.grammage = value;
      const grammage = this.effectiveGrammage(
        value,
        corrugationTheoreticalGrammage,
      );
      part.boxWeight = this.boxWeight(part.boxSurface, grammage);
    }

    // TODO(module-08): CalcularAletas + CalcularPlancha when a Modelo is set
    // (sheet dims, trazadores, flap formulas, RotacionObligatoria swap).
    return part;
  }

  /** Batch weight recalc (RecalcularPeso): returns the new weight. */
  recalculateBoxWeight(
    part: ICascadePart,
    corrugationTheoreticalGrammage: number | null,
  ): number | null {
    const grammage = this.effectiveGrammage(
      part.grammage,
      corrugationTheoreticalGrammage,
    );
    part.boxWeight = this.boxWeight(part.boxSurface, grammage);
    return part.boxWeight ?? null;
  }
}
