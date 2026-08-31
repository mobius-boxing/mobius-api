import {
  clearableText,
  codeText,
  requiredText,
  toBoolean,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/toolingType.ts`.
 *
 * Bounds come from `information_schema.columns` on the live schema
 * (2026-08-29), not from migrations and not from the demoted archetype table
 * (AMENDMENT A1):
 *   tooling_types.code                 varchar(50)  NOT NULL, UNIQUE (code)
 *   tooling_types.name                 varchar(255) NOT NULL
 *   tooling_types.description          text         NULL
 *   tooling_types.automaticConsumption boolean      NULL, default false
 *
 * `companyId` is NOT a DTO field — `BaseCrudController.create` injects it
 * from the caller's token after `buildCreateDTO` returns (L-009), so
 * nothing here may strip it.
 *
 * The unique index on `code` is GLOBAL, not `(companyId, code)`, so a 23505
 * from this table is cross-tenant. Pre-existing; untouched by this batch.
 *
 * 10000 is the project-wide cap for a nullable `text` column (B1 convention);
 * `description` had no rule at all on either side before this batch.
 *
 * The update DTO imports these constants so the two can never drift apart.
 */
export const TOOLING_TYPE_LIMITS = {
  code: 50,
  name: 255,
  description: 10000,
};

export const TOOLING_TYPE_LABELS = {
  code: "El código",
  name: "El nombre",
  description: "La descripción",
  automaticConsumption: "El consumo automático",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class ToolingTypeCreateInputDTO {
  code: string;
  name: string;
  description?: string | null;
  automaticConsumption?: boolean;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.code = source.code as string;
    this.name = source.name as string;
    this.description = source.description as string | null | undefined;
    if (source.automaticConsumption !== undefined) {
      this.automaticConsumption = source.automaticConsumption as boolean;
    }
  }

  public build(): this {
    collect((field) => {
      this.code = field("code", () =>
        codeText(this.code, TOOLING_TYPE_LIMITS.code, TOOLING_TYPE_LABELS.code),
      );
      this.name = field("name", () =>
        requiredText(
          this.name,
          TOOLING_TYPE_LIMITS.name,
          TOOLING_TYPE_LABELS.name,
        ),
      );
      this.description = field("description", () =>
        clearableText(
          this.description,
          TOOLING_TYPE_LIMITS.description,
          TOOLING_TYPE_LABELS.description,
        ),
      );
      if (this.automaticConsumption !== undefined) {
        this.automaticConsumption = field("automaticConsumption", () =>
          toBoolean(
            this.automaticConsumption,
            TOOLING_TYPE_LABELS.automaticConsumption,
          ),
        );
      }
    });

    // `inputValidator` (@sundaysf/utils) rejects ANY own key holding
    // `undefined` ("Param description is missing"), so an unset optional field
    // used to 400 a request the column would have accepted. Drop unset keys.
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });

    return this;
  }
}
