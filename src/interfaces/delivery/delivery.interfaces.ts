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
  /**
   * Server-owned: the one row per customer that mirrors `customers.address`
   * (customer-address-delivery D-3). Never taken from a request body.
   */
  isCustomerAddress?: boolean;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;

  // Related entities (populated by DAO joins)
  deliveryZone?: { uuid: string; code?: string | null; description?: string | null } | null;
  customer?: { uuid: string; name?: string } | null;
}

/**
 * A delivery location sent inline with `POST /customer` (customer-address-delivery
 * amendment 2, D-10). Zone already resolved to its numeric id by the controller.
 */
export interface INewCustomerDeliveryLocation {
  address: string;
  deliveryZoneId: number;
  schedule?: string | null;
  latitude?: number;
  longitude?: number;
  externalSystemCode?: string;
}
