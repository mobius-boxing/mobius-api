export interface IMachineType {
  id?: number;
  uuid?: string;
  companyId?: number;
  name: string;
  location?: number | null;
  requiresDie: boolean;
  requiresPlate: boolean;
  attribute?: string | null;
  corrugated: boolean;
  generatesSheets?: boolean | null;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IMachine {
  id?: number;
  uuid?: string;
  companyId?: number;
  code?: string | null;
  description?: string | null;
  machineTypeId?: number;
  sheetWidthMin?: number | null;
  sheetLengthMin?: number | null;
  sheetWidthMax?: number | null;
  sheetLengthMax?: number | null;
  width?: number | null;
  setupTime?: number;
  maxScoreLines?: number | null;
  sourceWarehouseId?: number | null;
  destinationWarehouseId?: number | null;
  linearMeters?: number | null;
  boxWidthMin?: number | null;
  boxWidthMax?: number | null;
  boxLengthMin?: number | null;
  boxLengthMax?: number | null;
  boxHeightMin?: number | null;
  boxHeightMax?: number | null;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;

  // Related entities (populated by DAO joins)
  machineType?: { uuid: string; name?: string; corrugated?: boolean } | null;
  sourceWarehouse?: { uuid: string; name?: string } | null;
  destinationWarehouse?: { uuid: string; name?: string } | null;
}
