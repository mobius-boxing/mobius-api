import { Request, Response, NextFunction } from "express";
import { AuditLogDAO } from "../../dao/audit-log/audit-log.dao";

/**
 * Read-only audit trail. There is no write path in the application any more:
 * P2 moved capture into the database, where the `audit_row_change()` trigger on
 * every audited table writes the row inside the request's own transaction.
 * History viewer for one record:
 *   GET /audit-logs?filter[entityName]=X&filter[entityUuid]=<uuid>&sortBy=occurredAt
 */
export class AuditLogController {
  private dao = new AuditLogDAO();

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result = await this.dao.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }
}
