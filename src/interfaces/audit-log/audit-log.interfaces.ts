export type AuditOperation = "Alta" | "Baja" | "Modificacion";

export interface IAuditLog {
  id?: number;
  uuid?: string;
  companyId?: number | null;
  entityName: string;
  entityLegacyId?: number | null;
  entityUuid?: string | null;
  entityCode?: string | null;
  entityDescription?: string | null;
  operation: AuditOperation;
  username?: string | null;
  userId?: number | null;
  snapshot?: Record<string, unknown> | null;
  occurredAt?: Date;
  legacyId?: number | null;
  createdAt?: Date;
}
