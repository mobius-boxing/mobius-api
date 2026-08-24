export interface IPalletType {
  id?: number;
  uuid?: string;
  companyId?: number;
  code?: string | null;
  description?: string | null;
  length?: number | null;
  width?: number | null;
  weight?: number | null;
  height?: number | null;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IPalletization {
  id?: number;
  uuid?: string;
  companyId?: number;
  code?: string | null;
  name: string;
  description?: string | null;
  boxesPerPackage?: number;
  packagesPerLevel?: number;
  levelsPerPallet?: number;
  additionalPackages?: number;
  sheetsPerPallet?: number;
  maxPalletHeight?: number | null;
  surface?: number | null;
  stackingType?: string | null;
  observations?: string | null;
  technicalFileUuid?: string | null;
  imageFileUuid?: string | null;
  palletTypeId?: number | null;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;

  /** Computed: boxesPerPackage * (packagesPerLevel * levelsPerPallet + additionalPackages) */
  boxesPerPallet?: number;
  // Related entities (populated by DAO joins)
  palletType?: { uuid: string; code?: string | null; description?: string | null } | null;
}
