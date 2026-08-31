import {
  clearableText,
  optionalInt,
  optionalText,
  requiredInt,
  requiredText,
  toBoolean,
} from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";
import { IContactInfo } from "../../../interfaces/customer/customer.interfaces";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/customer.ts`.
 *
 * Bounds from `information_schema.columns` on the live schema (2026-08-30)
 * (AMENDMENT A1):
 *   customers.name                       varchar(255) NOT NULL
 *   customers.legalName/tradeName        varchar(255) NULL
 *   customers.legal_code/supplier_code   varchar(255) NULL  ← snake_case columns
 *   customers.code                       varchar(400) NULL, UNIQUE ("companyId", code)
 *   customers.address/notes              text         NULL
 *   customers.active/dispatchable/excludeLogoOnLabels/requiresQualityCertificate boolean
 *   customers.categoryId/salesPersonId   integer NULL (FK, resolved ids)
 *   customers.contacts                   jsonb NULL, default '[]'
 *
 * `name` keeps the client's `minLength: 2` (a UI-only convention the B2
 * sign-off ruled is KEPT verbatim and never extended to other fields), which is
 * why it is `requiredText` with a 2 floor rather than the bare helper.
 *
 * `contacts` is jsonb assembled by the modal's contact editor. It is carried
 * through UNVALIDATED here, exactly as before: its shape is a list of contact
 * objects with no column-level constraint, and inventing one in a validation
 * batch would reject rows the app writes today.
 *
 * `companyId` is a resolved numeric id set by the controller before `build()`.
 *
 * NULL AND THE INTERFACE: the nullable text columns are typed `string |
 * undefined` on `ICustomer`, with no null. These fields keep `clearableText`
 * (so an empty string still CLEARS the value, which `optionalText` would turn
 * into "leave unchanged") and then map an explicit null to undefined — the same
 * treatment `PaperSupplyCreateInputDTO` documents, and exactly what the old
 * `legalName?: string` could express. ICustomer has no null to widen to.
 */
export const CUSTOMER_LIMITS = {
  name: 255,
  code: 400,
  text: 10000,
  /** Resolved numeric ids, not uuids. */
  id: { min: 1, max: 2147483647 },
};

export const CUSTOMER_LABELS = {
  companyId: "La empresa",
  name: "El nombre",
  code: "El c\u00f3digo",
  legalName: "La raz\u00f3n social",
  tradeName: "El nombre comercial",
  legalCode: "El CUIT",
  supplierCode: "El c\u00f3digo de proveedor",
  address: "La direcci\u00f3n",
  notes: "Las notas",
  categoryId: "El rubro",
  salesPersonId: "El vendedor",
  active: "El estado",
  dispatchable: "Despachable",
  excludeLogoOnLabels: "Excluir logo en etiquetas",
  requiresQualityCertificate: "Requiere certificado de calidad",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class CustomerCreateInputDTO {
  companyId: number;
  name: string;
  code?: string;
  legalName?: string;
  tradeName?: string;
  legalCode?: string;
  supplierCode?: string;
  address?: string;
  notes?: string;
  categoryId?: number;
  salesPersonId?: number;
  active?: boolean;
  dispatchable?: boolean;
  excludeLogoOnLabels?: boolean;
  requiresQualityCertificate?: boolean;
  /**
   * jsonb, assembled by the modal's contact editor. Carried through
   * UNVALIDATED, exactly as before: the column has no constraint on the shape,
   * and inventing one in a validation batch would reject rows the app writes
   * today. The DAO owns it.
   */
  contacts?: IContactInfo[];

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.companyId = source.companyId as number;
    this.name = source.name as string;
    this.code = source.code as string;
    this.legalName = source.legalName as string;
    this.tradeName = source.tradeName as string;
    this.legalCode = source.legalCode as string;
    this.supplierCode = source.supplierCode as string;
    this.address = source.address as string;
    this.notes = source.notes as string;
    this.categoryId = source.categoryId as number;
    this.salesPersonId = source.salesPersonId as number;
    this.active = source.active as boolean;
    this.dispatchable = source.dispatchable as boolean;
    this.excludeLogoOnLabels = source.excludeLogoOnLabels as boolean;
    this.requiresQualityCertificate = source.requiresQualityCertificate as boolean;
    this.contacts = source.contacts as IContactInfo[] | undefined;
  }

  public build(): this {
    collect((field) => {
      this.companyId = field("companyId", () =>
        requiredInt(this.companyId, CUSTOMER_LIMITS.id, CUSTOMER_LABELS.companyId),
      );
      this.name = field("name", () =>
        requiredText(this.name, CUSTOMER_LIMITS.name, CUSTOMER_LABELS.name),
      );
      this.code = field("code", () =>
        optionalText(this.code, CUSTOMER_LIMITS.code, CUSTOMER_LABELS.code),
      ) ?? undefined;
      this.legalName = field("legalName", () =>
        clearableText(this.legalName, CUSTOMER_LIMITS.name, CUSTOMER_LABELS.legalName),
      ) ?? undefined;
      this.tradeName = field("tradeName", () =>
        clearableText(this.tradeName, CUSTOMER_LIMITS.name, CUSTOMER_LABELS.tradeName),
      ) ?? undefined;
      this.legalCode = field("legalCode", () =>
        clearableText(this.legalCode, CUSTOMER_LIMITS.name, CUSTOMER_LABELS.legalCode),
      ) ?? undefined;
      this.supplierCode = field("supplierCode", () =>
        clearableText(this.supplierCode, CUSTOMER_LIMITS.name, CUSTOMER_LABELS.supplierCode),
      ) ?? undefined;
      this.address = field("address", () =>
        clearableText(this.address, CUSTOMER_LIMITS.text, CUSTOMER_LABELS.address),
      ) ?? undefined;
      this.notes = field("notes", () =>
        clearableText(this.notes, CUSTOMER_LIMITS.text, CUSTOMER_LABELS.notes),
      ) ?? undefined;
      this.categoryId = field("categoryId", () =>
        optionalInt(this.categoryId, CUSTOMER_LIMITS.id, CUSTOMER_LABELS.categoryId),
      );
      this.salesPersonId = field("salesPersonId", () =>
        optionalInt(this.salesPersonId, CUSTOMER_LIMITS.id, CUSTOMER_LABELS.salesPersonId),
      );
      this.active = field("active", () =>
        toBoolean(this.active, CUSTOMER_LABELS.active),
      );
      this.dispatchable = field("dispatchable", () =>
        toBoolean(this.dispatchable, CUSTOMER_LABELS.dispatchable),
      );
      this.excludeLogoOnLabels = field("excludeLogoOnLabels", () =>
        toBoolean(this.excludeLogoOnLabels, CUSTOMER_LABELS.excludeLogoOnLabels),
      );
      this.requiresQualityCertificate = field("requiresQualityCertificate", () =>
        toBoolean(this.requiresQualityCertificate, CUSTOMER_LABELS.requiresQualityCertificate),
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
