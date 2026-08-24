import { Request, Response, NextFunction } from "express";
import { AuditLogDAO } from "../../dao/audit-log/audit-log.dao";
import { enforceCompanyFilter } from "../../utils/companyScope";

/**
 * Read-only audit trail (the write path is AuditService, called by controllers).
 * History viewer for one record:
 *   GET /audit-logs?filter[entityName]=X&filter[entityUuid]=<uuid>&sortBy=occurredAt
 */
export class AuditLogController {
  private dao = new AuditLogDAO();

  public async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      enforceCompanyFilter(req);
      const result = await this.dao.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }
}
