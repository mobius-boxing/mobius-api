export interface IColor {
  id?: number;
  uuid?: string;
  companyId?: number;
  code?: string;
  name?: string;
  description?: string;
  observations?: string;
  /** Print-shade index (Procusto Tonalidad — semantics refine with Q-05-8). */
  tonality?: number | null;
  colorTypeId?: number | null;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}
