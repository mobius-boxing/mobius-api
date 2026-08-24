export interface IFile {
  id?: number;
  uuid: string;
  companyId: number;
  originalName: string;
  description?: string | null;
  storageKey: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  checksum?: string | null;
  uploadedBy?: number | null;
  legacyId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}
