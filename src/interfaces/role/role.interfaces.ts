export interface IRole {
  id?: number;
  uuid: string;
  companyId: number;
  name: string;
  profileType: string;
  hasAccessToAllMachines: boolean;
  isProtected: boolean;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
  /** Granted permission codes (populated on getByUuid). */
  permissionCodes?: string[];
}

export interface IPermission {
  id?: number;
  uuid: string;
  companyId: number;
  code: string;
  name: string;
  description?: string | null;
  readOnly: boolean;
  associatedForms?: string | null;
  area?: string | null;
  deprecated: boolean;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}
