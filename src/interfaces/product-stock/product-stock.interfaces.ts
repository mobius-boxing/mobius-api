export interface IProductStock {
  uuid?: string;
  warehouse?: { uuid: string; name: string } | null;
  product?: {
    uuid: string;
    code: string;
    description: string | null;
  } | null;
  productionOrder?: { uuid: string; number: string } | null;
  quantity?: number;
  comments?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}
