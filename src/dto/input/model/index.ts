import { validate, validateList } from "../../../services/formula-engine";
import { IModelTextOnImage } from "../../../interfaces/model/model.interfaces";

/**
 * Model DTOs — module 08. Every formula field is design-time validated
 * through the engine (`Formula.Testear` parity): the 8 scalar fields via
 * `validate()`, the 2 pipe-`|` trazadores lists via `validateList()`.
 * `boxSurfaceFormula` IS validated (divergence D-3). Failure messages name
 * the offending field key, and `field[i]` for a bad list segment.
 *
 * PARITY (L-010): formula text passes through byte-for-byte — no trimming,
 * re-spacing or normalisation. The single exception: an empty string means
 * "no formula" and is stored as null, not "".
 */
const MODEL_SCALAR_FORMULA_FIELDS = [
  "sheetLengthFormula",
  "sheetWidthFormula",
  "lowerFlapFormula",
  "upperFlapFormula",
  "externalLengthDeltaFormula",
  "externalWidthDeltaFormula",
  "externalHeightDeltaFormula",
  "boxSurfaceFormula",
] as const;

const MODEL_LIST_FORMULA_FIELDS = [
  "corrugationScoreLineFormulas",
  "printScoreLineFormulas",
] as const;

// SECURITY: matches `models.code` varchar(100). Without this the DB raises
// 22001 string_data_right_truncation, which used to surface as a 500 echoing
// knex's `insert into "models" (...)` message.
const MAX_CODE_LENGTH = 100;

type FormulaField =
  | (typeof MODEL_SCALAR_FORMULA_FIELDS)[number]
  | (typeof MODEL_LIST_FORMULA_FIELDS)[number];

export class ModelCreateInputDTO {
  code?: string;
  description!: string;
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
  textsOnImage?: IModelTextOnImage[];
  // SECURITY: file + lookup references arrive as UUIDs.
  imageFileUuid?: string | null;
  flapTypeUuid?: string | null;
  complementUuid?: string | null;

  constructor(data: any) {
    if (data.code !== undefined) this.code = data.code;
    if (data.description !== undefined) this.description = data.description;
    if (data.imageFileUuid !== undefined)
      this.imageFileUuid = data.imageFileUuid;
    if (data.flapTypeUuid !== undefined) this.flapTypeUuid = data.flapTypeUuid;
    if (data.complementUuid !== undefined)
      this.complementUuid = data.complementUuid;
    if (data.textsOnImage !== undefined) this.textsOnImage = data.textsOnImage;
    const self = this as Record<string, unknown>;
    for (const key of [
      ...MODEL_SCALAR_FORMULA_FIELDS,
      ...MODEL_LIST_FORMULA_FIELDS,
    ]) {
      if (data[key] !== undefined) {
        // Empty means "no formula": stored as NULL, never "" (spec §Trazadores).
        self[key] = data[key] === "" ? null : data[key];
      }
    }
  }

  protected validateFormulas(): void {
    const self = this as Partial<Record<FormulaField, string | null>>;
    for (const key of MODEL_SCALAR_FORMULA_FIELDS) {
      const formula = self[key];
      if (formula === undefined || formula === null) continue;
      if (typeof formula !== "string") {
        throw new Error(`${key} must be a formula string`);
      }
      const result = validate(formula);
      if (!result.ok) {
        throw new Error(`${key}: ${result.error}`);
      }
    }
    for (const key of MODEL_LIST_FORMULA_FIELDS) {
      const text = self[key];
      if (text === undefined || text === null) continue;
      if (typeof text !== "string") {
        throw new Error(`${key} must be a pipe-separated formula list`);
      }
      const result = validateList(text);
      if (!result.ok) {
        const bad = result.segments.find((segment) => !segment.ok);
        throw new Error(`${key}[${bad?.index ?? 0}]: ${bad?.error}`);
      }
    }
  }

  protected validateCodeLength(): void {
    if (this.code === undefined || this.code === null) return;
    if (String(this.code).length > MAX_CODE_LENGTH) {
      throw new Error(
        `Model code cannot be longer than ${MAX_CODE_LENGTH} characters`,
      );
    }
  }

  protected validateTextsOnImage(): void {
    if (this.textsOnImage === undefined) return;
    if (!Array.isArray(this.textsOnImage)) {
      throw new Error("textsOnImage must be an array");
    }
    for (const entry of this.textsOnImage) {
      if (
        entry === null ||
        typeof entry !== "object" ||
        typeof entry.x !== "number" ||
        !Number.isFinite(entry.x) ||
        typeof entry.y !== "number" ||
        !Number.isFinite(entry.y) ||
        typeof entry.texto !== "string" ||
        typeof entry.campo !== "string"
      ) {
        throw new Error(
          "textsOnImage entries must be {x: number, y: number, texto: string, campo: string}",
        );
      }
    }
  }

  public build(): this {
    // models.code is nullable at the column (future ETL) but the API
    // requires it (divergence D-2); description is the hard NOT NULL.
    if (!this.code || !String(this.code).trim()) {
      throw new Error("Model code is required");
    }
    if (!this.description || !String(this.description).trim()) {
      throw new Error("Model description is required");
    }
    this.validateCodeLength();
    this.validateFormulas();
    this.validateTextsOnImage();
    return this;
  }
}

export class ModelUpdateInputDTO extends ModelCreateInputDTO {
  public build(): this {
    if (this.code !== undefined && (!this.code || !String(this.code).trim())) {
      throw new Error("Model code cannot be empty");
    }
    if (
      this.description !== undefined &&
      (!this.description || !String(this.description).trim())
    ) {
      throw new Error("Model description cannot be empty");
    }
    this.validateCodeLength();
    this.validateFormulas();
    this.validateTextsOnImage();
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}
