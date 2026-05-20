export interface IStoreBox {
  id?: number;
  uuid?: string;
  companyId?: number;
  description: string;
  unitsPerPackage: number;
  unitsPerPallet: number;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
