export interface IColorType {
  id?: number;
  uuid?: string;
  companyId?: number;
  name: string;
  description?: string;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}
