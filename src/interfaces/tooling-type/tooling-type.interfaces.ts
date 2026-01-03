export interface IToolingType {
  id?: number;
  uuid?: string;
  code: string;
  name: string;
  description?: string;
  automaticConsumption?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
