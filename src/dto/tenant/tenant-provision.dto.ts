import { collect } from "../input/shared/ValidationError";
import { optionalUuid } from "../input/shared/fieldValidators";

/**
 * `POST /api/companies/:uuid/tenant-database/provision` body (model, T10).
 * Every field is optional — an absent `serverUuid` means "the default
 * placement row" (`beginProvisioning`'s own fallback).
 */
export class TenantProvisionInputDTO {
  serverUuid?: string;

  constructor(data: any) {
    if (data?.serverUuid !== undefined) this.serverUuid = data.serverUuid;
  }

  public build(): this {
    collect((field) => {
      this.serverUuid = field("serverUuid", () =>
        optionalUuid(this.serverUuid, "El servidor"),
      );
    });
    return this;
  }
}
