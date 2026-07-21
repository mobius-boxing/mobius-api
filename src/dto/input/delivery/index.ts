import { toNumberInput as num } from "../../../utils/numbers";

export class DeliveryZoneCreateInputDTO {
  code?: string;
  description?: string;

  constructor(data: any) {
    if (data.code !== undefined) this.code = data.code;
    if (data.description !== undefined) this.description = data.description;
  }

  public build(): this {
    return this;
  }
}

export class DeliveryZoneUpdateInputDTO {
  code?: string;
  description?: string;

  constructor(data: any) {
    if (data.code !== undefined) this.code = data.code;
    if (data.description !== undefined) this.description = data.description;
  }

  public build(): this {
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) delete this[key as keyof this];
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
