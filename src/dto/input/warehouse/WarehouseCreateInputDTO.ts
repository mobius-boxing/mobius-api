import { requiredInt, requiredText } from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/warehouse.ts`.
 *
 * Bounds come from `information_schema.columns` on the live schema
 * (2026-08-29), not from migrations and not from the demoted archetype table
 * (AMENDMENT A1):
 *   warehouses.name      varchar(255) NOT NULL
 *   warehouses.gridRows  integer      NOT NULL, default 10 (precision 32, scale 0)
 *   warehouses.gridCols  integer      NOT NULL, default 10 (precision 32, scale 0)
 *   warehouses.companyId integer      NOT NULL
 *
 * SIGN-OFF (2026-08-29): both numerics are PLAIN `integer` columns with ZERO
 * CHECK constraints, so Postgres itself would take any int32. The 1..50 bound
 * is a pure PRODUCT rule that predates this batch (the Create modal and
 * `WarehouseGridEditorModal` both enforce it) and is KEPT verbatim — it is NOT
 * widened to the int32 range.
 *
 * `companyId` IS a field here, unlike the other `BaseCrudController` entities:
 * `WarehouseController.beforeCreate` resolves the numeric company id from the
 * caller's token (superAdmins may name a company uuid in the body) and writes
 * it onto the payload BEFORE constructing this DTO, so it must survive
 * `build()` untouched (L-009). It is never read from raw user input here, and
 * the controller uses its own resolved value for the insert regardless.
 *
 * The update DTO imports these constants so the two can never drift apart.
 */
export const WAREHOUSE_LIMITS = {
  name: 255,
  /** Product rule, not a DB constraint: the column is an unbounded `integer`. */
  gridMin: 1,
  gridMax: 50,
};

/** The column default, applied here so a create that omits the grid still works. */
export const WAREHOUSE_GRID_DEFAULT = 10;

export const WAREHOUSE_LABELS = {
  name: "El nombre",
  gridRows: "El número de filas",
  gridCols: "El número de columnas",
};

const GRID_BOUNDS = {
  min: WAREHOUSE_LIMITS.gridMin,
  max: WAREHOUSE_LIMITS.gridMax,
};

/**
 * `undefined` / `null` / `""` mean "the request did not state a grid size", so
 * the column's default applies exactly as it did before this batch. Anything
 * else — including `0` and `"abc"`, both of which used to reach knex — is
 * validated.
 */
const orDefault = (value: unknown): unknown =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "")
    ? WAREHOUSE_GRID_DEFAULT
    : value;

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class WarehouseCreateInputDTO {
  name: string;
  gridRows: number;
  gridCols: number;
  companyId: number;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.name = source.name as string;
    this.gridRows = orDefault(source.gridRows) as number;
    this.gridCols = orDefault(source.gridCols) as number;
    this.companyId =
      typeof source.companyId === "string"
        ? parseInt(source.companyId, 10)
        : (source.companyId as number);
  }

  public build(): this {
    collect((field) => {
      this.name = field("name", () =>
        requiredText(this.name, WAREHOUSE_LIMITS.name, WAREHOUSE_LABELS.name),
      );
      this.gridRows = field("gridRows", () =>
        requiredInt(this.gridRows, GRID_BOUNDS, WAREHOUSE_LABELS.gridRows),
      );
      this.gridCols = field("gridCols", () =>
        requiredInt(this.gridCols, GRID_BOUNDS, WAREHOUSE_LABELS.gridCols),
      );
    });

    // `inputValidator` (@sundaysf/utils) rejects ANY own key holding
    // `undefined` ("Param companyId is missing"), so an unset optional field
    // used to 400 a request the column would have accepted. Drop unset keys.
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });

    return this;
  }
}
