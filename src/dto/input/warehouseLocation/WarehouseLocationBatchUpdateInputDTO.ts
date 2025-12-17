export class WarehouseLocationBatchUpdateInputDTO {
  locations: Array<{
    row: number;
    col: number;
    status?: string;
    locationType?: string;
    locationCode?: string;
    capacity?: any;
    metadata?: any;
  }>;

  constructor(data: any) {
    this.locations = data.locations || [];
  }

  public build(): this {
    return this;
  }
}
