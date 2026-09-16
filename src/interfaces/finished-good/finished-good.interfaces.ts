export interface IFinishedGood {
  id?: number;
  uuid?: string;
  companyId?: number;
  code?: string | null;
  name: string;
  description?: string | null;
  supplierId?: number | null;
  manufacturerId?: number | null;
  /** Interim plain ints until modules 07/12 land (Q-09-3). D-10 renamed this column. */
  productId?: number | null;
  stageId?: number | null;
  minimumStock?: number | null;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;

  // Related entities (populated by DAO joins)
  supplier?: { uuid: string; name?: string } | null;
  manufacturer?: { uuid: string; name?: string } | null;
}
