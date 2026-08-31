import {
  clearableText,
  codeText,
  optionalInt,
  optionalNumber,
  optionalUuid,
  toBoolean,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/corrugation.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30),
 * not from migrations (AMENDMENT A1):
 *   corrugations.code                varchar(50)   NOT NULL, UNIQUE (code) GLOBAL
 *   corrugations.description         text          NULL
 *   corrugations.theoreticalGrammage numeric(10,2) NULL → max 99999999.99
 *   corrugations.suggestedWidth      numeric(10,2) NULL → max 99999999.99
 *   corrugations.caliper             numeric(10,4) NULL → max 999999.9999
 *   corrugations.corrugationClassId  integer       NULL (FK; DTO takes the uuid)
 *
 * The three numerics do NOT share a bound: `numeric(10,2)` and `numeric(10,4)`
 * spend the same ten digits differently, so `caliper`'s ceiling is a hundred
 * times smaller. Separate constants, never one shared "measure".
 *
 * `layers` IS validated here even though the client schema skips it: the layer
 * grid is local `useState` in the modal (pattern B, deferred to B7), so until
 * that lands the server is the ONLY thing standing between a malformed layer
 * row and the corrugation_layers insert. Validating it server-side now costs
 * nothing and closes the gap early.
 *
 * `companyId` is NOT a DTO field — the controller injects it from the caller's
 * token (L-009).
 */
export const CORRUGATION_LIMITS = {
  code: 50,
  description: 10000,
  /** numeric(10,2) */
  grammage: { min: 0, max: 99999999.99, decimals: 2 },
  /** numeric(10,4) — same precision, four decimals, far smaller ceiling. */
  caliper: { min: 0, max: 999999.9999, decimals: 4 },
  /** `corrugation_layers.position` is a plain integer. */
  position: { min: 0, max: 2147483647 },
};

export const CORRUGATION_LABELS = {
  code: "El código",
  description: "La descripción",
  theoreticalGrammage: "El gramaje teórico",
  suggestedWidth: "El ancho sugerido",
  caliper: "El calibre",
  corrugationClassUuid: "La clase de corrugado",
  layerUuid: "El identificador de la capa",
  layerPosition: "La posición de la capa",
  layerIsLiner: "El indicador de liner",
  layerPaperClassUuid: "La clase de papel de la capa",
  layerFluteTypeUuid: "El tipo de onda de la capa",
};

export interface ICorrugationLayerInput {
  /** Identity reference for the diff-and-upsert path (audit P1b): it says which
   * stored layer this row is, so an edit updates that row instead of recreating
   * it. Never written — an unknown uuid becomes a new server-minted row. Absent
   * on create, and on any layer the client just added. */
  uuid?: string;
  position?: number;
  isLiner?: boolean;
  paperClassUuid?: string;
  fluteTypeUuid?: string;
}

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class CorrugationCreateInputDTO {
  code: string;
  description?: string | null;
  theoreticalGrammage?: number;
  suggestedWidth?: number;
  caliper?: number;
  // SECURITY: Accept UUID from frontend, not numeric ID
  corrugationClassUuid?: string;
  // Capas — the layer stack, ordered; each row references lookups by UUID.
  layers?: ICorrugationLayerInput[];

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.code = source.code as string;
    this.description = source.description as string | null | undefined;
    this.theoreticalGrammage = source.theoreticalGrammage as number | undefined;
    this.suggestedWidth = source.suggestedWidth as number | undefined;
    this.caliper = source.caliper as number | undefined;
    this.corrugationClassUuid = source.corrugationClassUuid as
      | string
      | undefined;
    if (Array.isArray(source.layers)) {
      this.layers = source.layers as ICorrugationLayerInput[];
    }
  }

  public build(): this {
    collect((field) => {
      this.code = field("code", () =>
        codeText(this.code, CORRUGATION_LIMITS.code, CORRUGATION_LABELS.code),
      );
      this.description = field("description", () =>
        clearableText(
          this.description,
          CORRUGATION_LIMITS.description,
          CORRUGATION_LABELS.description,
        ),
      );
      this.theoreticalGrammage = field("theoreticalGrammage", () =>
        optionalNumber(
          this.theoreticalGrammage,
          CORRUGATION_LIMITS.grammage,
          CORRUGATION_LABELS.theoreticalGrammage,
        ),
      );
      this.suggestedWidth = field("suggestedWidth", () =>
        optionalNumber(
          this.suggestedWidth,
          CORRUGATION_LIMITS.grammage,
          CORRUGATION_LABELS.suggestedWidth,
        ),
      );
      this.caliper = field("caliper", () =>
        optionalNumber(
          this.caliper,
          CORRUGATION_LIMITS.caliper,
          CORRUGATION_LABELS.caliper,
        ),
      );
      this.corrugationClassUuid = field("corrugationClassUuid", () =>
        optionalUuid(
          this.corrugationClassUuid,
          CORRUGATION_LABELS.corrugationClassUuid,
        ),
      );

      // Each layer is reported under its own index so a bad row in a stack of
      // six says WHICH row, not just "layers".
      if (this.layers !== undefined) {
        this.layers = this.layers.map((layer, index) => ({
          position: field(`layers.${index}.position`, () =>
            optionalInt(
              layer?.position,
              CORRUGATION_LIMITS.position,
              CORRUGATION_LABELS.layerPosition,
            ),
          ),
          isLiner: field(`layers.${index}.isLiner`, () =>
            toBoolean(layer?.isLiner, CORRUGATION_LABELS.layerIsLiner),
          ),
          paperClassUuid: field(`layers.${index}.paperClassUuid`, () =>
            optionalUuid(
              layer?.paperClassUuid,
              CORRUGATION_LABELS.layerPaperClassUuid,
            ),
          ),
          fluteTypeUuid: field(`layers.${index}.fluteTypeUuid`, () =>
            optionalUuid(
              layer?.fluteTypeUuid,
              CORRUGATION_LABELS.layerFluteTypeUuid,
            ),
          ),
        }));
      }
    });

    // `inputValidator` rejects ANY own key holding `undefined`, so a blank
    // optional measure used to 400 a request the nullable column would accept.
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });

    return this;
  }
}
