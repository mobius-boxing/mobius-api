import {
  clearableText,
  codeText,
  optionalInt,
  optionalNumber,
  optionalUuid,
  toBoolean,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import {
  CORRUGATION_LABELS,
  CORRUGATION_LIMITS,
  ICorrugationLayerInput,
} from "./CorrugationCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention.
 *
 * `layers` is all-or-nothing by design: absent means "leave the stack alone",
 * present means "this IS the stack now" (the controller renumbers 1..N and the
 * DAO replaces the rows). An empty array therefore clears every layer, which is
 * why it must stay distinguishable from `undefined` here.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class CorrugationUpdateInputDTO {
  code?: string;
  description?: string | null;
  theoreticalGrammage?: number | null;
  suggestedWidth?: number | null;
  caliper?: number | null;
  // SECURITY: Accept UUID from frontend, not numeric ID
  corrugationClassUuid?: string | null;
  layers?: ICorrugationLayerInput[];

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.code !== undefined) this.code = source.code as string;
    if (source.description !== undefined)
      this.description = source.description as string | null;
    if (source.theoreticalGrammage !== undefined)
      this.theoreticalGrammage = source.theoreticalGrammage as number | null;
    if (source.suggestedWidth !== undefined)
      this.suggestedWidth = source.suggestedWidth as number | null;
    if (source.caliper !== undefined)
      this.caliper = source.caliper as number | null;
    if (source.corrugationClassUuid !== undefined)
      this.corrugationClassUuid = source.corrugationClassUuid as string | null;
    if (Array.isArray(source.layers))
      this.layers = source.layers as ICorrugationLayerInput[];
  }

  public build(): this {
    collect((field) => {
      if (this.code !== undefined) {
        this.code = field("code", () =>
          codeText(
            this.code,
            CORRUGATION_LIMITS.code,
            CORRUGATION_LABELS.code,
          ),
        );
      }
      if (this.description !== undefined) {
        this.description = field("description", () =>
          clearableText(
            this.description,
            CORRUGATION_LIMITS.description,
            CORRUGATION_LABELS.description,
          ),
        );
      }
      // `null` clears a nullable numeric column; only a real value is bounded.
      if (
        this.theoreticalGrammage !== undefined &&
        this.theoreticalGrammage !== null
      ) {
        this.theoreticalGrammage = field("theoreticalGrammage", () =>
          optionalNumber(
            this.theoreticalGrammage,
            CORRUGATION_LIMITS.grammage,
            CORRUGATION_LABELS.theoreticalGrammage,
          ),
        );
      }
      if (this.suggestedWidth !== undefined && this.suggestedWidth !== null) {
        this.suggestedWidth = field("suggestedWidth", () =>
          optionalNumber(
            this.suggestedWidth,
            CORRUGATION_LIMITS.grammage,
            CORRUGATION_LABELS.suggestedWidth,
          ),
        );
      }
      if (this.caliper !== undefined && this.caliper !== null) {
        this.caliper = field("caliper", () =>
          optionalNumber(
            this.caliper,
            CORRUGATION_LIMITS.caliper,
            CORRUGATION_LABELS.caliper,
          ),
        );
      }
      if (
        this.corrugationClassUuid !== undefined &&
        this.corrugationClassUuid !== null
      ) {
        this.corrugationClassUuid = field("corrugationClassUuid", () =>
          optionalUuid(
            this.corrugationClassUuid,
            CORRUGATION_LABELS.corrugationClassUuid,
          ),
        );
      }
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

    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });

    return this;
  }
}
