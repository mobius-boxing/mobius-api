export interface IConsumableType {
  id?: number;
  uuid?: string;
  companyId?: number;
  code: string;
  name: string;
  autoConsumption?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
