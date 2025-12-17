export interface IWarehouseLocation {
  id?: number;
  uuid?: string;
  warehouseId: number;
  row: number;
  col: number;
  status: string;
  locationType: string;
  locationCode?: string;
  capacity?: any;
  metadata?: any;
  createdAt?: Date;
  updatedAt?: Date;
}
