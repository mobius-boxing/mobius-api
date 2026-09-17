/**
 * Product calculations — specs/parts/03-calculations.md + 06-cascade-and-dimensions.md,
 * folded onto `products` (D-1). Moved/renamed from `services/part-calculator`,
 * alongside the rest of the removed-composite-products cleanup.
 *
 * Scope note: with products.modelId still largely unset on live rows, the
 * cascade paths here are:
 *   - internal ↔ external via the Modelo's delta formula when a model is set
 *     and the formula is non-empty, else the corrugation's FIRST flute-type
 *     static adjustments (AjusteLargo/Ancho/Altura → flute_types.length/width/height)
 *   - boxSurface → boxWeight (the ONLY auto-weight path;
 *     PesoEditableEnPartes=False at the live customer → weight computed)
 *
 * Model-driven cascade (fefco-sheet-calculation, `ParteCotizada.cs:636-904`,
 * `Formula.cs:38-85`): CalcularAletas (lower/upper flap formulas) then
 * CalcularPlancha (sheet length/width, box surface, score-line lists;
 * `mandatoryRotation` swaps the sheet length/width AND score-line
 * destinations) run after any dimension, flap, model or rotation edit, when
 * a model is set. `AumentoEnFormula` (Troquelado1..16, and its Chapetón
 * override) is out of scope (brief non-goal) — tr1..tr16 are bound as 0.
 *
 * All arithmetic in IEEE-754 doubles (parity — 03 gotcha #5, L-010).
 */
import { evaluate, evaluateList, type Scope } from "../formula-engine";
import { formatScoreLines } from "../score-lines/score-lines.helper";

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
  | "grammage"
  | "flap"
  | "mandatoryRotation"
  | "model";

/**
 * The 10 Modelo formula fields `CalcularAletas`/`CalcularPlancha` read
 * (`IModel`, module 08). Kept local rather than importing `IModel` — this
 * service only ever needs the formula text, not the model's joined refs.
 */
export interface IModelFormulas {
  sheetLengthFormula?: string | null;
  sheetWidthFormula?: string | null;
  corrugationScoreLineFormulas?: string | null;
  printScoreLineFormulas?: string | null;
  lowerFlapFormula?: string | null;
  upperFlapFormula?: string | null;
  externalLengthDeltaFormula?: string | null;
  externalWidthDeltaFormula?: string | null;
  externalHeightDeltaFormula?: string | null;
  boxSurfaceFormula?: string | null;
}

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

  sheetLength?: number | null;
  sheetWidth?: number | null;
  additionalSheetLength?: number | null;

  flap?: number | null;
  lowerFlap?: number | null;
  upperFlap?: number | null;
  flapOverlap?: number | null;

  corrugationScoreLines?: string | null;
  printScoreLines?: string | null;

  mandatoryRotation?: boolean;
}

const AXES = [
  {
    internal: "boxLength",
    external: "externalLength",
    adjust: "length",
    deltaFormula: "externalLengthDeltaFormula",
  },
  {
    internal: "boxWidth",
    external: "externalWidth",
    adjust: "width",
    deltaFormula: "externalWidthDeltaFormula",
  },
  {
    internal: "boxHeight",
    external: "externalHeight",
    adjust: "height",
    deltaFormula: "externalHeightDeltaFormula",
  },
] as const;

/** Fields whose edit re-runs CalcularAletas + CalcularPlancha (algorithm §2). */
const MODEL_CASCADE_TRIGGERS = new Set<CascadeField>([
  "boxLength",
  "boxWidth",
  "boxHeight",
  "externalLength",
  "externalWidth",
  "externalHeight",
  "flap",
  "mandatoryRotation",
  "model",
]);

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

  /** SetearSuperficieCaja: writes boxSurface and recomputes boxWeight. */
  private setBoxSurface(
    product: ICalculableProduct,
    value: number | null,
    corrugationTheoreticalGrammage: number | null,
  ): void {
    product.boxSurface = value;
    const grammage = this.effectiveGrammage(
      product.grammage,
      corrugationTheoreticalGrammage,
    );
    product.boxWeight = this.boxWeight(value, grammage);
  }

  /**
   * `Formula.Evaluar(string, ParteCotizada, AumentoEnFormula)` binding
   * (`Formula.cs:38-85`) — the exact 32 keys that overload binds. Unset
   * numeric fields bind as 0 (Convert.ToDouble on Procusto's non-nullable
   * `double` columns). No `AumentoEnFormula` (non-goal): tr1..tr16 are 0.
   */
  private buildFormulaScope(
    product: ICalculableProduct,
    caliper: number | null,
    corrugationTheoreticalGrammage: number | null,
  ): Scope {
    const troquelado = Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [`tr${i + 1}`, 0]),
    );
    return {
      Largo: product.boxLength ?? 0,
      Base: product.boxWidth ?? 0,
      Ancho: product.boxWidth ?? 0,
      Altura: product.boxHeight ?? 0,
      "Largo adicional": product.additionalSheetLength ?? 0,
      "Largo externo": product.externalLength ?? 0,
      "Base externa": product.externalWidth ?? 0,
      "Ancho externo": product.externalWidth ?? 0,
      "Altura externa": product.externalHeight ?? 0,
      "Aleta inferior": product.lowerFlap ?? 0,
      "Aleta superior": product.upperFlap ?? 0,
      Chapeton: product.flap ?? 0,
      "Superposicion aletas": product.flapOverlap ?? 0,
      t: caliper ?? 0,
      "Gramaje teorico": corrugationTheoreticalGrammage ?? 0,
      ...troquelado,
      "Rotacion obligatoria": product.mandatoryRotation ? 1 : 0,
    };
  }

  /** CalcularAletas (`ParteCotizada.cs:891-904`): non-empty flap formulas only. */
  private calcularAletas(
    product: ICalculableProduct,
    model: IModelFormulas,
    caliper: number | null,
    corrugationTheoreticalGrammage: number | null,
  ): void {
    const scope = this.buildFormulaScope(
      product,
      caliper,
      corrugationTheoreticalGrammage,
    );
    if (model.lowerFlapFormula && model.lowerFlapFormula.trim() !== "") {
      product.lowerFlap = evaluate(model.lowerFlapFormula, scope);
    }
    if (model.upperFlapFormula && model.upperFlapFormula.trim() !== "") {
      product.upperFlap = evaluate(model.upperFlapFormula, scope);
    }
  }

  /**
   * CalcularPlancha (`ParteCotizada.cs:832-888`): sheet length/width, box
   * surface (only when both sheet formulas are non-empty) and the two
   * score-line lists. `mandatoryRotation` swaps the sheet length/width AND
   * score-line destinations; the surface guard and value are unaffected.
   */
  private calcularPlancha(
    product: ICalculableProduct,
    model: IModelFormulas,
    caliper: number | null,
    corrugationTheoreticalGrammage: number | null,
  ): void {
    const scope = this.buildFormulaScope(
      product,
      caliper,
      corrugationTheoreticalGrammage,
    );
    const hasSheetLength = !!model.sheetLengthFormula?.trim();
    const hasSheetWidth = !!model.sheetWidthFormula?.trim();
    const hasCorrugationLines = !!model.corrugationScoreLineFormulas?.trim();
    const hasPrintLines = !!model.printScoreLineFormulas?.trim();

    const sheetLengthValue = evaluate(model.sheetLengthFormula, scope);
    const sheetWidthValue = evaluate(model.sheetWidthFormula, scope);
    const surfaceValue = evaluate(model.boxSurfaceFormula, scope);
    const corrugationText = formatScoreLines(
      evaluateList(model.corrugationScoreLineFormulas, scope),
    );
    const printText = formatScoreLines(
      evaluateList(model.printScoreLineFormulas, scope),
    );

    if (!product.mandatoryRotation) {
      if (hasSheetLength) product.sheetLength = sheetLengthValue;
      if (hasSheetWidth) product.sheetWidth = sheetWidthValue;
      if (hasCorrugationLines) product.corrugationScoreLines = corrugationText;
      if (hasPrintLines) product.printScoreLines = printText;
    } else {
      if (hasSheetWidth) product.sheetLength = sheetWidthValue;
      if (hasSheetLength) product.sheetWidth = sheetLengthValue;
      if (hasPrintLines) product.corrugationScoreLines = printText;
      if (hasCorrugationLines) product.printScoreLines = corrugationText;
    }
    if (hasSheetLength && hasSheetWidth) {
      this.setBoxSurface(product, surfaceValue, corrugationTheoreticalGrammage);
    }
  }

  /**
   * Apply one field edit and cascade (06-cascade-and-dimensions.md), mutating
   * and returning the product. `flute` = the corrugation's FIRST flute-type
   * adjustments (Corrugado.TiposDeOnda().First() — only the first is
   * consulted, even for multi-wall). Delta source order: Modelo delta
   * formula (when `model` is set and the formula is non-empty) → flute
   * adjustment → 0 (external == internal). `model`/`caliper` absent → today's
   * behaviour (AC-3).
   */
  applyEdit(
    product: ICalculableProduct,
    field: CascadeField,
    value: number | boolean | null,
    flute: IFluteAdjustments | null,
    corrugationTheoreticalGrammage: number | null,
    model?: IModelFormulas | null,
    caliper?: number | null,
  ): ICalculableProduct {
    const axisByInternal = AXES.find((a) => a.internal === field);
    const axisByExternal = AXES.find((a) => a.external === field);

    const deltaFor = (axis: (typeof AXES)[number]): number => {
      const formula = model?.[axis.deltaFormula];
      if (model && formula && formula.trim() !== "") {
        return evaluate(
          formula,
          this.buildFormulaScope(
            product,
            caliper ?? null,
            corrugationTheoreticalGrammage,
          ),
        );
      }
      return flute?.[axis.adjust] ?? 0;
    };

    if (axisByInternal) {
      const v = value as number | null;
      (product as any)[axisByInternal.internal] = v;
      if (v != null) {
        (product as any)[axisByInternal.external] = v;
        const delta = deltaFor(axisByInternal);
        (product as any)[axisByInternal.external] = v + delta;
      }
    } else if (axisByExternal) {
      const v = value as number | null;
      (product as any)[axisByExternal.external] = v;
      if (v != null) {
        (product as any)[axisByExternal.internal] = v;
        const delta = deltaFor(axisByExternal);
        (product as any)[axisByExternal.internal] = v - delta;
      }
    } else if (field === "boxSurface") {
      this.setBoxSurface(
        product,
        value as number | null,
        corrugationTheoreticalGrammage,
      );
    } else if (field === "grammage") {
      product.grammage = value as number | null;
      const grammage = this.effectiveGrammage(
        value as number | null,
        corrugationTheoreticalGrammage,
      );
      product.boxWeight = this.boxWeight(product.boxSurface, grammage);
    } else if (field === "flap") {
      product.flap = value as number | null;
    } else if (field === "mandatoryRotation") {
      product.mandatoryRotation = value === true;
    }
    // field === "model": no direct write — modelId/model context is already
    // on `product`/`model`; the cascade below is the entire point of the edit.

    if (model && MODEL_CASCADE_TRIGGERS.has(field)) {
      this.calcularAletas(
        product,
        model,
        caliper ?? null,
        corrugationTheoreticalGrammage,
      );
      this.calcularPlancha(
        product,
        model,
        caliper ?? null,
        corrugationTheoreticalGrammage,
      );
    }

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
