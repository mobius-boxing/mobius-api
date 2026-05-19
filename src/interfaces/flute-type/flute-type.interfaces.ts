export interface IFluteType {
  id?: number;
  uuid?: string;
  companyId?: number;
  code: string;
  description?: string;
  fluteFactor?: number;
  length?: number;
  width?: number;
  height?: number;
  createdAt?: Date;
  updatedAt?: Date;
}
