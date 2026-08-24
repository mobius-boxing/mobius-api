/**
 * Box model (Procusto `Modelos`) — module 08.
 *
 * PARITY (L-010): the 10 formula fields are raw text, stored byte-for-byte.
 * The two *ScoreLineFormulas fields are pipe-`|` lists split at the field
 * level by the formula engine — never normalised or re-ordered here.
 */
export interface IModelTextOnImage {
  x: number;
  y: number;
  texto: string;
  campo: string;
}

export interface IModel {
  id?: number;
  uuid?: string;
  companyId?: number;
  code?: string | null;
  description: string;
  sheetLengthFormula?: string | null; // LargoPlancha
  sheetWidthFormula?: string | null; // AnchoPlancha
  corrugationScoreLineFormulas?: string | null; // TrazadoresCorrugado (|-list)
  printScoreLineFormulas?: string | null; // TrazadoresImpresion (|-list)
  lowerFlapFormula?: string | null; // AletaInferior
  upperFlapFormula?: string | null; // AletaSuperior
  externalLengthDeltaFormula?: string | null; // DiferenciaLargoExterno
  externalWidthDeltaFormula?: string | null; // DiferenciaAnchoExterno
  externalHeightDeltaFormula?: string | null; // DiferenciaAlturaExterna
  boxSurfaceFormula?: string | null; // SuperficieCaja
  imageFileUuid?: string | null;
  textsOnImage?: IModelTextOnImage[];
  flapTypeId?: number | null;
  complementId?: number | null;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;

  // Outward uuid references (derived from the joins; AC-21)
  flapTypeUuid?: string | null;
  complementUuid?: string | null;

  // Related entities (populated by DAO joins, uuid-only outward)
  flapType?: {
    uuid: string;
    code?: string | null;
    description?: string | null;
  } | null;
  complement?: {
    uuid: string;
    code?: string | null;
    description?: string | null;
  } | null;
}
