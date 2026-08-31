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
import { CUSTOMER_LABELS, CUSTOMER_LIMITS } from "./CustomerCreateInputDTO";

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. Present fields are held to the create rules: blanking a required one
 * must fail here rather than as a NOT NULL violation whose knex message carries
 * the generated SQL.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class CustomerUpdateInputDTO {
  companyId?: number;
  name?: string;
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
  /** jsonb pass-through — see the create DTO. */
  contacts?: IContactInfo[];

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.companyId !== undefined)
      this.companyId = source.companyId as number;
    if (source.name !== undefined)
      this.name = source.name as string;
    if (source.code !== undefined)
      this.code = source.code as string;
    if (source.legalName !== undefined)
      this.legalName = source.legalName as string;
    if (source.tradeName !== undefined)
      this.tradeName = source.tradeName as string;
    if (source.legalCode !== undefined)
      this.legalCode = source.legalCode as string;
    if (source.supplierCode !== undefined)
      this.supplierCode = source.supplierCode as string;
    if (source.address !== undefined)
      this.address = source.address as string;
    if (source.notes !== undefined)
      this.notes = source.notes as string;
    if (source.categoryId !== undefined)
      this.categoryId = source.categoryId as number;
    if (source.salesPersonId !== undefined)
      this.salesPersonId = source.salesPersonId as number;
    if (source.active !== undefined)
      this.active = source.active as boolean;
    if (source.dispatchable !== undefined)
      this.dispatchable = source.dispatchable as boolean;
    if (source.excludeLogoOnLabels !== undefined)
      this.excludeLogoOnLabels = source.excludeLogoOnLabels as boolean;
    if (source.requiresQualityCertificate !== undefined)
      this.requiresQualityCertificate = source.requiresQualityCertificate as boolean;
    if (source.contacts !== undefined)
      this.contacts = source.contacts as IContactInfo[];
  }

  public build(): this {
    collect((field) => {
      if (this.companyId !== undefined) {
        this.companyId = field("companyId", () =>
          requiredInt(this.companyId, CUSTOMER_LIMITS.id, CUSTOMER_LABELS.companyId),
        );
      }
      if (this.name !== undefined) {
        this.name = field("name", () =>
          requiredText(this.name, CUSTOMER_LIMITS.name, CUSTOMER_LABELS.name),
        );
      }
      if (this.code !== undefined) {
        this.code = field("code", () =>
          optionalText(this.code, CUSTOMER_LIMITS.code, CUSTOMER_LABELS.code),
        ) ?? undefined;
      }
      if (this.legalName !== undefined) {
        this.legalName = field("legalName", () =>
          clearableText(this.legalName, CUSTOMER_LIMITS.name, CUSTOMER_LABELS.legalName),
        ) ?? undefined;
      }
      if (this.tradeName !== undefined) {
        this.tradeName = field("tradeName", () =>
          clearableText(this.tradeName, CUSTOMER_LIMITS.name, CUSTOMER_LABELS.tradeName),
        ) ?? undefined;
      }
      if (this.legalCode !== undefined) {
        this.legalCode = field("legalCode", () =>
          clearableText(this.legalCode, CUSTOMER_LIMITS.name, CUSTOMER_LABELS.legalCode),
        ) ?? undefined;
      }
      if (this.supplierCode !== undefined) {
        this.supplierCode = field("supplierCode", () =>
          clearableText(this.supplierCode, CUSTOMER_LIMITS.name, CUSTOMER_LABELS.supplierCode),
        ) ?? undefined;
      }
      if (this.address !== undefined) {
        this.address = field("address", () =>
          clearableText(this.address, CUSTOMER_LIMITS.text, CUSTOMER_LABELS.address),
        ) ?? undefined;
      }
      if (this.notes !== undefined) {
        this.notes = field("notes", () =>
          clearableText(this.notes, CUSTOMER_LIMITS.text, CUSTOMER_LABELS.notes),
        ) ?? undefined;
      }
      if (this.categoryId !== undefined) {
        this.categoryId = field("categoryId", () =>
          optionalInt(this.categoryId, CUSTOMER_LIMITS.id, CUSTOMER_LABELS.categoryId),
        );
      }
      if (this.salesPersonId !== undefined) {
        this.salesPersonId = field("salesPersonId", () =>
          optionalInt(this.salesPersonId, CUSTOMER_LIMITS.id, CUSTOMER_LABELS.salesPersonId),
        );
      }
      if (this.active !== undefined) {
        this.active = field("active", () =>
          toBoolean(this.active, CUSTOMER_LABELS.active),
        );
      }
      if (this.dispatchable !== undefined) {
        this.dispatchable = field("dispatchable", () =>
          toBoolean(this.dispatchable, CUSTOMER_LABELS.dispatchable),
        );
      }
      if (this.excludeLogoOnLabels !== undefined) {
        this.excludeLogoOnLabels = field("excludeLogoOnLabels", () =>
          toBoolean(this.excludeLogoOnLabels, CUSTOMER_LABELS.excludeLogoOnLabels),
        );
      }
      if (this.requiresQualityCertificate !== undefined) {
        this.requiresQualityCertificate = field("requiresQualityCertificate", () =>
          toBoolean(this.requiresQualityCertificate, CUSTOMER_LABELS.requiresQualityCertificate),
        );
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
