import { Request } from "express";
import KnexManager from "../database/KnexConnection";
import { AuditLogDAO } from "../dao/audit-log/audit-log.dao";
import {
  AuditOperation,
  IAuditLog,
} from "../interfaces/audit-log/audit-log.interfaces";

/**
 * Post-commit audit hook (Procusto `GenericLogger` replacement — spec:
 * modules/01-system-and-cross-cutting/audit-log.md).
 *
 * Best-effort by contract: a failed audit insert is logged to console and NEVER
 * propagates — audit must not block or roll back the business write (parity with
 * GenericLogger's try/catch swallow).
 *
 * Coverage divergence (user decision 2026-07-18): Procusto audits exactly four
 * entities; Mobius wires this into BaseCrudController so nearly every entity gets
 * history. The snapshot is the saved row (full new state, not a delta) — the
 * viewer diffs consecutive snapshots, as in Procusto.
 */
export class AuditService {
  private dao = new AuditLogDAO();

  /**
   * Record one audit row for a request-scoped entity write.
   * `entity` is the saved row (Alta/Modificacion) or the pre-delete row (Baja).
   */
  async record(
    req: Request,
    entityName: string,
    operation: AuditOperation,
    entity: Record<string, any> | null,
  ): Promise<void> {
    try {
      const user = (req as any).user;
      const [userId, companyId] = await Promise.all([
        user?.userId ? this.resolveUserId(user.userId) : Promise.resolve(null),
        this.resolveCompanyId(entity, user?.companyId),
      ]);
      const row: IAuditLog = {
        entityName,
        operation,
        entityUuid: entity?.uuid ?? null,
        entityCode: entity?.code ?? null,
        entityDescription: entity?.description ?? entity?.name ?? null,
        username: user?.email ?? null,
        userId,
        companyId,
        // Baja carries no snapshot (parity with GenericLogger).
        snapshot: operation === "Baja" ? null : (entity as any),
      };
      await this.dao.insert(row);
    } catch (err) {
      console.error(`[audit] failed to record ${operation} on ${entityName}:`, err);
    }
  }

  private async resolveUserId(userUuid: string): Promise<number | null> {
    try {
      const knex = KnexManager.getConnection();
      const row = await knex("users").where("uuid", userUuid).select("id").first();
      return row?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Prefer the entity's own numeric companyId; fall back to resolving the JWT
   * company UUID. Returns null for global/companyless entities.
   */
  private async resolveCompanyId(
    entity: Record<string, any> | null,
    companyUuid?: string,
  ): Promise<number | null> {
    const own = entity?.companyId;
    if (typeof own === "number") return own;
    if (!companyUuid) return null;
    try {
      const knex = KnexManager.getConnection();
      const row = await knex("companies")
        .where("uuid", companyUuid)
        .select("id")
        .first();
      return row?.id ?? null;
    } catch {
      return null;
    }
  }
}
