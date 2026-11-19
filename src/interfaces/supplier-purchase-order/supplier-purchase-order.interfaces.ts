export const SUPPLIER_PO_STATUSES = ["draft", "sent", "completed"] as const;
export type SupplierPurchaseOrderStatus = (typeof SUPPLIER_PO_STATUSES)[number];

export const SUPPLIER_PO_LINE_STATUSES = [
  "pending",
  "partial",
  "completed",
] as const;
export type SupplierPurchaseOrderLineStatus =
  (typeof SUPPLIER_PO_LINE_STATUSES)[number];

/** I-10: `completed` iff `completedAt` is set, else `partial` iff anything was received. */
export function deriveLineStatus(l: {
  receivedQuantity: number;
  completedAt: Date | null;
}): SupplierPurchaseOrderLineStatus {
  if (l.completedAt != null) return "completed";
  return l.receivedQuantity > 0 ? "partial" : "pending";
}

export type SupplierPoolStatus = "unassigned" | "in-draft";
export type SupplierPoolNotReady = "no-sheet-dimensions" | "no-corrugation";
export const SUPPLIER_POOL_STATUSES: readonly SupplierPoolStatus[] = [
  "unassigned",
  "in-draft",
];

export interface ISupplierRef {
  uuid: string;
  code: string;
}

export interface ISupplierMachineRef {
  uuid: string;
  code: string | null;
  supplier: ISupplierRef;
}

export interface ISupplierReceipt {
  uuid?: string;
  quantity?: number;
  /** Product units = quantity / line.sheetsPerUnit (no rounding). */
  unitQuantity?: number;
  receivedAt?: Date;
  receivedByUser?: string;
  warehouse?: { uuid: string; name: string } | null;
  productStock?: { uuid: string } | null;
  notes?: string | null;
  createdAt?: Date;
}

export interface ISupplierPurchaseOrderLine {
  uuid?: string;
  position?: number;
  productionOrder?: { uuid: string; number: string };
  customer?: { uuid: string; name: string } | null;
  product?: { uuid: string; code: string; description: string | null } | null;
  deliveryDate?: Date | null;
  orderNumber?: string | null;
  boardCode?: string | null;
  quantity?: number;
  sheetLength?: number | null;
  sheetWidth?: number | null;
  scoreLines?: string | null;
  /** Snapshot at send; null while draft. */
  sheetsPerUnit?: number | null;
  receivedQuantity?: number;
  /** `GET /lines` only: sum of the receipts' unitQuantity. */
  receivedUnits?: number;
  status?: SupplierPurchaseOrderLineStatus;
  completedAt?: Date | null;
  completedByUser?: string | null;
  receipts?: ISupplierReceipt[];
}

export interface ISupplierPurchaseOrder {
  uuid?: string;
  number?: number;
  status?: SupplierPurchaseOrderStatus;
  machine?: {
    uuid: string;
    code: string | null;
    destinationWarehouse: { uuid: string; name: string } | null;
  };
  supplier?: ISupplierRef;
  notes?: string | null;
  sentAt?: Date | null;
  sentByUser?: string | null;
  completedAt?: Date | null;
  createdByUser?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  lines?: ISupplierPurchaseOrderLine[];
  lineCount?: number;
  orderedQuantity?: number;
  receivedQuantity?: number;
}

export interface ISupplierPoolRow {
  productionOrder: { uuid: string; number: string };
  customer: { uuid: string; name: string } | null;
  product: { uuid: string; code: string; description: string | null };
  orderQuantity: number;
  requiredSheets: number;
  deliveryDate: Date | null;
  boardCode: string | null;
  sheetLength: number | null;
  sheetWidth: number | null;
  scoreLines: string | null;
  status: SupplierPoolStatus;
  purchaseOrder: {
    uuid: string;
    number: number;
    supplier: ISupplierRef;
  } | null;
  suggestedMachine: ISupplierMachineRef | null;
  candidateMachines: ISupplierMachineRef[];
  notReady: SupplierPoolNotReady | null;
}

/** The stored header row with its numeric ids — internal, never serialised. */
export interface ISupplierPurchaseOrderRow {
  id: number;
  uuid: string;
  companyId: number;
  number: number;
  machineId: number;
  supplierId: number;
  status: SupplierPurchaseOrderStatus;
  notes: string | null;
  sentAt: Date | null;
  sentByUser: string | null;
  completedAt: Date | null;
}

/** The stored line row with its numeric ids — internal, never serialised. */
export interface ISupplierPurchaseOrderLineRow {
  id: number;
  uuid: string;
  companyId: number;
  purchaseOrderId: number;
  productionOrderId: number;
  position: number;
  quantity: number;
  deliveryDate: Date | null;
  sheetsPerUnit: number | null;
  receivedQuantity: number;
  completedAt: Date | null;
}
