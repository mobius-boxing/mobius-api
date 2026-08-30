import {
  codeText,
  requiredText,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/paperClass.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30):
 *   paper_classes.code varchar(50)  NOT NULL, UNIQUE (code) — GLOBAL
 *   paper_classes.name varchar(255) NOT NULL
 *
 * The unique index is GLOBAL, not `(companyId, code)`, so a 23505 here is
 * cross-tenant: another company already owns that code.
 *
 * `papers` — the `paper_class_papers` many-to-many the modal's DualListSelector
 * manages — is NOT validated here beyond staying an array. Each uuid in it is
 * resolved by the controller, which already 400s an unknown one with a precise
 * message; duplicating that as a shape check would add a second, weaker guard.
 *
 * `companyId` is injected by the controller from the caller's token (L-009).
 */
export const PAPER_CLASS_LIMITS = {
  code: 50,
  name: 255,
};

export const PAPER_CLASS_LABELS = {
  code: "El c\u00f3digo",
  name: "El nombre",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class PaperClassCreateInputDTO {
  code: string;
  name: string;
  /**
   * The `paper_class_papers` many-to-many, as uuids. Carried through
   * unvalidated: the controller resolves each uuid and already 400s an unknown
   * one with a precise message, so a shape check here would be a second,
   * weaker guard on the same input.
   */
  papers?: unknown;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.code = source.code as string;
    this.name = source.name as string;
    this.papers = source.papers;
  }

  public build(): this {
    collect((field) => {
      this.code = field("code", () =>
        codeText(this.code, PAPER_CLASS_LIMITS.code, PAPER_CLASS_LABELS.code),
      );
      this.name = field("name", () =>
        requiredText(this.name, PAPER_CLASS_LIMITS.name, PAPER_CLASS_LABELS.name),
      );
    });

    // `inputValidator` rejects ANY own key holding `undefined`, so a blank
    // optional field used to 400 a request the nullable column would accept.
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });

    return this;
  }
}
