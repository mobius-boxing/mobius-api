export interface IStoreRoll {
  id?: number;
  uuid?: string;
  companyId?: number;
  description: string;
  minQuantity?: number; // defaults to 50 at DB level
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
