import { toNumberInput as num } from "../../../utils/numbers";
import { clearableText, codeText } from "../shared/fieldValidators";
import { collect } from "../shared/ValidationError";

/**
 * Server mirror of `mobius-web-app/src/validation/schemas/deliveryZone.ts`.
 *
 * Bounds come from `information_schema.columns` on the live schema
 * (2026-08-29), not from migrations and not from the demoted archetype table
 * (AMENDMENT A1):
 *   delivery_zones.code        varchar(400) NULL
 *   delivery_zones.description text         NULL
 *
 * SIGN-OFF (2026-08-29): `code` is NULLABLE in the column but REQUIRED here,
 * mirroring the client rule. 0 of 46 rows lack a code and the form has never
 * accepted a blank one, so the nullability reads as sloppy schema; a follow-up
 * card adds NOT NULL. Relaxing the API instead would be a product regression.
 *
 * 10000 is the project-wide cap for a nullable `text` column (B1 convention).
 *
 * `companyId` is NOT a DTO field — the controller's `beforeCreate` resolves it
 * from the caller's token (L-009), so nothing here may strip it.
 *
 * The update DTO reuses these constants so the two can never drift apart.
 */
export const DELIVERY_ZONE_LIMITS = {
  code: 400,
  description: 10000,
};

export const DELIVERY_ZONE_LABELS = {
  code: "El código",
  description: "La descripción",
};

/** Values are raw until `build()`: the constructor only captures what arrived. */
export class DeliveryZoneCreateInputDTO {
  code: string;
  description?: string | null;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.code = source.code as string;
    this.description = source.description as string | null | undefined;
  }

  public build(): this {
    collect((field) => {
      this.code = field("code", () =>
        codeText(
          this.code,
          DELIVERY_ZONE_LIMITS.code,
          DELIVERY_ZONE_LABELS.code,
        ),
      );
      this.description = field("description", () =>
        clearableText(
          this.description,
          DELIVERY_ZONE_LIMITS.description,
          DELIVERY_ZONE_LABELS.description,
        ),
      );
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

/**
 * Only the fields the request actually carried are set, and `build()` strips
 * whatever stayed unset — so a partial update never blanks a column it did not
 * mention. A present `code` is still validated: the form requires it.
 *
 * Values are raw until `build()`: the constructor only captures what arrived.
 */
export class DeliveryZoneUpdateInputDTO {
  code?: string;
  description?: string | null;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.code !== undefined) {
      this.code = source.code as string;
    }
    if (source.description !== undefined) {
      this.description = source.description as string | null;
    }
  }

  public build(): this {
    collect((field) => {
      if (this.code !== undefined) {
        this.code = field("code", () =>
          codeText(
            this.code,
            DELIVERY_ZONE_LIMITS.code,
            DELIVERY_ZONE_LABELS.code,
          ),
        );
      }
      if (this.description !== undefined) {
        this.description = field("description", () =>
          clearableText(
            this.description,
            DELIVERY_ZONE_LIMITS.description,
            DELIVERY_ZONE_LABELS.description,
          ),
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

export class DeliveryLocationCreateInputDTO {
  customerUuid: string;
  address?: string;
  schedule?: string;
  latitude?: number;
  longitude?: number;
  externalSystemCode?: string;
  // §L.6: required at API validation (DB column stays nullable for ETL).
  deliveryZoneUuid: string;

  constructor(data: any) {
    this.customerUuid = data.customerUuid;
    this.deliveryZoneUuid = data.deliveryZoneUuid;
    if (data.address !== undefined) this.address = data.address;
    if (data.schedule !== undefined) this.schedule = data.schedule;
    if (num(data.latitude) !== undefined) this.latitude = num(data.latitude);
    if (num(data.longitude) !== undefined) this.longitude = num(data.longitude);
    if (data.externalSystemCode !== undefined)
      this.externalSystemCode = data.externalSystemCode;
  }

  public build(): this {
    return this;
  }
}

export class DeliveryLocationUpdateInputDTO {
  address?: string;
  schedule?: string;
  latitude?: number;
  longitude?: number;
  externalSystemCode?: string;
  deliveryZoneUuid?: string;

  constructor(data: any) {
    if (data.address !== undefined) this.address = data.address;
    if (data.schedule !== undefined) this.schedule = data.schedule;
    if (num(data.latitude) !== undefined) this.latitude = num(data.latitude);
    if (num(data.longitude) !== undefined) this.longitude = num(data.longitude);
    if (data.externalSystemCode !== undefined)
      this.externalSystemCode = data.externalSystemCode;
    if (data.deliveryZoneUuid !== undefined)
      this.deliveryZoneUuid = data.deliveryZoneUuid;
  }

  public build(): this {
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) delete this[key as keyof this];
    });
    return this;
  }
}
