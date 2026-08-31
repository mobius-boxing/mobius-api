import { toNumberInput, toIntInput } from "../../../utils/numbers";
import {
  clearableText,
  optionalInt,
  optionalNumber,
  requiredText,
  requiredUuid,
  toBoolean,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

const NUMERIC_KEYS = [
  "sheetWidthMin",
  "sheetLengthMin",
  "sheetWidthMax",
  "sheetLengthMax",
  "width",
  "setupTime",
  "maxScoreLines",
  "linearMeters",
  "boxWidthMin",
  "boxWidthMax",
  "boxLengthMin",
  "boxLengthMax",
  "boxHeightMin",
  "boxHeightMax",
] as const;

type MachineNumericKey = (typeof NUMERIC_KEYS)[number];

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/machineType.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30),
 * not from migrations (AMENDMENT A1):
 *   machine_types.name            varchar(400) NOT NULL, UNIQUE ("companyId", name)
 *   machine_types.attribute       varchar(400) NULL
 *   machine_types.location        smallint     NULL  → -32768..32767, NOT int32
 *   machine_types.requiresDie     boolean NOT NULL, default false
 *   machine_types.requiresPlate   boolean NOT NULL, default false
 *   machine_types.corrugated      boolean NOT NULL, default false
 *   machine_types.generatesSheets boolean NULL
 *
 * This entity has NO `code` column — `name` carries the identity and the unique
 * index, so there is no `codeText` rule here.
 *
 * `location` is a `smallint`, the only one in this sweep. Its ceiling is 32767,
 * not the 2147483647 every other integer field gets: the old `toIntInput` had
 * no bound at all, so 40000 reached Postgres and came back as a 22003 range
 * error carrying the SQL. Neither modal renders this field today, but the
 * column is writable through the API, so the rule belongs on the server even
 * though the client schema has nothing to mirror.
 *
 * `companyId` is NOT a DTO field — the controller injects it from the caller's
 * token (L-009).
 */
export const MACHINE_TYPE_LIMITS = {
  name: 400,
  attribute: 400,
  /** `smallint`, not `integer`. */
  location: { min: -32768, max: 32767 },
};

export const MACHINE_TYPE_LABELS = {
  name: "El nombre",
  location: "La ubicaci\u00f3n",
  attribute: "El atributo",
  requiresDie: "Requiere troquel",
  requiresPlate: "Requiere clis\u00e9",
  corrugated: "Corrugado",
  generatesSheets: "Genera l\u00e1minas",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class MachineTypeCreateInputDTO {
  name!: string;
  location?: number;
  requiresDie?: boolean;
  requiresPlate?: boolean;
  attribute?: string | null;
  corrugated?: boolean;
  generatesSheets?: boolean;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.name = source.name as string;
    this.location = source.location as number | undefined;
    this.requiresDie = source.requiresDie as boolean | undefined;
    this.requiresPlate = source.requiresPlate as boolean | undefined;
    this.attribute = source.attribute as string | null | undefined;
    this.corrugated = source.corrugated as boolean | undefined;
    this.generatesSheets = source.generatesSheets as boolean | undefined;
  }

  protected validate(required: boolean): void {
    collect((field) => {
      if (required || this.name !== undefined) {
        this.name = field("name", () =>
          requiredText(
            this.name,
            MACHINE_TYPE_LIMITS.name,
            MACHINE_TYPE_LABELS.name,
          ),
        );
      }
      if (this.location !== undefined) {
        this.location = field("location", () =>
          optionalInt(
            this.location,
            MACHINE_TYPE_LIMITS.location,
            MACHINE_TYPE_LABELS.location,
          ),
        );
      }
      if (this.attribute !== undefined) {
        this.attribute = field("attribute", () =>
          clearableText(
            this.attribute,
            MACHINE_TYPE_LIMITS.attribute,
            MACHINE_TYPE_LABELS.attribute,
          ),
        );
      }
      const flags = [
        "requiresDie",
        "requiresPlate",
        "corrugated",
        "generatesSheets",
      ] as const;
      for (const flag of flags) {
        if (this[flag] === undefined) continue;
        this[flag] = field(flag, () =>
          toBoolean(this[flag], MACHINE_TYPE_LABELS[flag]),
        );
      }
    });
  }

  public build(): this {
    this.validate(true);
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}

/**
 * Only the fields the request carried are validated, and unset keys are
 * stripped. A present `name` is still held to the create rule: blanking a NOT
 * NULL column must fail here, not as a knex error carrying the SQL.
 */
export class MachineTypeUpdateInputDTO extends MachineTypeCreateInputDTO {
  public build(): this {
    this.validate(false);
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}

/**
 * `machines` numerics are all `numeric(12,3)` on the live schema (2026-08-30).
 */
export const MACHINE_LIMITS = {
  code: 400,
  description: 10000,
  measure: { min: 0, max: 999999999.999, decimals: 3 },
};

export const MACHINE_LABELS: Record<string, string> = {
  code: "El código",
  description: "La descripción",
  machineTypeUuid: "El tipo de máquina",
  setupTime: "El tiempo de preparación",
  sheetWidthMin: "El ancho mínimo de lámina",
  sheetWidthMax: "El ancho máximo de lámina",
  sheetLengthMin: "El largo mínimo de lámina",
  sheetLengthMax: "El largo máximo de lámina",
  width: "El ancho",
  maxScoreLines: "La cantidad máxima de trazadores",
  linearMeters: "Los metros lineales",
  boxWidthMin: "El ancho mínimo de caja",
  boxWidthMax: "El ancho máximo de caja",
  boxLengthMin: "El largo mínimo de caja",
  boxLengthMax: "El largo máximo de caja",
  boxHeightMin: "La altura mínima de caja",
  boxHeightMax: "La altura máxima de caja",
};

/** Closed allow-list (no index signature — see CLAUDE.md validation rule). */
export class MachineCreateInputDTO {
  code?: string;
  description?: string;
  // SECURITY: UUIDs from the client, resolved to ids in the controller.
  machineTypeUuid!: string;
  sourceWarehouseUuid?: string;
  destinationWarehouseUuid?: string;
  sheetWidthMin?: number;
  sheetLengthMin?: number;
  sheetWidthMax?: number;
  sheetLengthMax?: number;
  width?: number;
  setupTime?: number;
  maxScoreLines?: number;
  linearMeters?: number;
  boxWidthMin?: number;
  boxWidthMax?: number;
  boxLengthMin?: number;
  boxLengthMax?: number;
  boxHeightMin?: number;
  boxHeightMax?: number;

  constructor(data: any) {
    if (data.machineTypeUuid !== undefined) this.machineTypeUuid = data.machineTypeUuid;
    if (data.code !== undefined) this.code = data.code;
    if (data.description !== undefined) this.description = data.description;
    if (data.sourceWarehouseUuid !== undefined)
      this.sourceWarehouseUuid = data.sourceWarehouseUuid;
    if (data.destinationWarehouseUuid !== undefined)
      this.destinationWarehouseUuid = data.destinationWarehouseUuid;
    const self = this as Record<string, unknown>;
    for (const key of NUMERIC_KEYS) {
      const v = toNumberInput(data[key]);
      if (v !== undefined) self[key] = v;
    }
  }

  /**
   * Every numeric column on `machines` is `numeric(12,3)`, so all fourteen get
   * the same ceiling (999999999.999) and scale (3) — the old loop only checked
   * `>= 0` and let an over-precision or out-of-range value reach the column as
   * a 22003 carrying the SQL.
   *
   * Note the client schema bounds only the four numbers `MachineModals`
   * renders; this bounds all fourteen, because the API is reachable without the
   * form.
   */
  protected validate(required: boolean): void {
    collect((field) => {
      if (required || this.machineTypeUuid !== undefined) {
        this.machineTypeUuid = field("machineTypeUuid", () =>
          requiredUuid(this.machineTypeUuid, MACHINE_LABELS.machineTypeUuid),
        );
      }
      const self = this as Record<string, unknown>;
      for (const key of NUMERIC_KEYS) {
        if (self[key] === undefined) continue;
        self[key] = field(key, () =>
          optionalNumber(
            self[key],
            MACHINE_LIMITS.measure,
            MACHINE_LABELS[key] ?? key,
          ),
        );
      }
    });
  }

  public build(): this {
    this.validate(true);
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}

export class MachineUpdateInputDTO extends MachineCreateInputDTO {
  public build(): this {
    this.validate(false);
    const self = this as Record<string, unknown>;
    Object.keys(self).forEach((key) => {
      if (self[key] === undefined) delete self[key];
    });
    return this;
  }
}
