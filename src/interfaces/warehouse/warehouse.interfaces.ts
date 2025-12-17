export interface IWarehouse {
  id?: number;
  uuid?: string;
  name: string;
  gridRows?: number;
  gridCols?: number;
  companyId?: number;
  createdAt?: Date;
  updatedAt?: Date;
}
