export class WarehouseLocationUpdateInputDTO {
  status?: string;
  locationType?: string;
  locationCode?: string;
  capacity?: any;
  metadata?: any;

  constructor(data: any) {
    if (data.status !== undefined) this.status = data.status;
    if (data.locationType !== undefined) this.locationType = data.locationType;
    if (data.locationCode !== undefined) this.locationCode = data.locationCode;
    if (data.capacity !== undefined) this.capacity = data.capacity;
    if (data.metadata !== undefined) this.metadata = data.metadata;
  }

  public build(): this {
    Object.keys(this).forEach((key) => {
      if (this[key as keyof this] === undefined) {
        delete this[key as keyof this];
      }
    });
    return this;
  }
}
