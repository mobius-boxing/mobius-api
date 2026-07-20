export interface IDeliveryZone {
  id?: number;
  uuid?: string;
  companyId?: number;
  code?: string | null;
  description?: string | null;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IDeliveryLocation {
  id?: number;
  uuid?: string;
  companyId?: number;
  customerId?: number;
  address?: string | null;
  /** Free-text hours (Procusto Horario). */
  schedule?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  externalSystemCode?: string | null;
  deliveryZoneId?: number | null;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;

  // Related entities (populated by DAO joins)
  deliveryZone?: { uuid: string; code?: string | null; description?: string | null } | null;
  customer?: { uuid: string; name?: string } | null;
}
