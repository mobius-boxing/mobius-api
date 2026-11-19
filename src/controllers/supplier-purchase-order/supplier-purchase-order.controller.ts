import { Request, Response, NextFunction } from "express";
import { setAuditAction } from "../../database/audit-context";
import * as service from "../../services/supplier-purchase-order.service";
import type { ServiceResult } from "../../services/supplier-purchase-order.service";
import {
  SupplierPurchaseOrderCreateInputDTO,
  SupplierPurchaseOrderUpdateInputDTO,
  SupplierReceiptCreateInputDTO,
} from "../../dto/input/supplier-purchase-order";

/**
 * `/api/supplier-purchase-orders` — thin req/res translation of the service's
 * `ServiceResult`; every call is scoped to the caller's `req.companyId` (L-009).
 */
export class SupplierPurchaseOrderController {
  private companyOf(req: Request, res: Response): number | null {
    if (req.companyId === undefined) {
      res
        .status(400)
        .json({ success: false, message: "A company is required" });
      return null;
    }
    return req.companyId;
  }

  private send<T>(res: Response, result: ServiceResult<T>, status = 200): void {
    if (!result.ok) {
      res.status(result.status).json({
        success: false,
        message: result.message,
        ...(result.code ? { code: result.code } : {}),
        ...(result.details !== undefined ? { details: result.details } : {}),
      });
      return;
    }
    res.status(status).json({ success: true, data: result.data });
  }

  private invalid(req: Request, next: NextFunction, e: unknown): void {
    req.statusCode = 400;
    next(new Error(e instanceof Error ? e.message : "Invalid request"));
  }

  public async getPool(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.companyOf(req, res);
      if (companyId === null) return;
      res.status(200).json(await service.getPool(req, companyId));
    } catch (err) {
      next(err);
    }
  }

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.companyOf(req, res);
      if (companyId === null) return;
      res.status(200).json(await service.listPurchaseOrders(req, companyId));
    } catch (err) {
      next(err);
    }
  }

  public async getLines(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.companyOf(req, res);
      if (companyId === null) return;
      res.status(200).json(await service.listLines(req, companyId));
    } catch (err) {
      next(err);
    }
  }

  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.companyOf(req, res);
      if (companyId === null) return;
      const data = await service.getDetail(companyId, req.params.uuid);
      if (!data) {
        res
          .status(404)
          .json({ success: false, message: "Purchase order not found" });
        return;
      }
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.companyOf(req, res);
      if (companyId === null) return;
      let dto: SupplierPurchaseOrderCreateInputDTO;
      try {
        dto = new SupplierPurchaseOrderCreateInputDTO(req.body).build();
      } catch (e) {
        return this.invalid(req, next, e);
      }
      this.send(
        res,
        await service.createPurchaseOrder(
          companyId,
          req.user?.email ?? null,
          dto,
        ),
        201,
      );
    } catch (err) {
      next(err);
    }
  }

  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.companyOf(req, res);
      if (companyId === null) return;
      let dto: SupplierPurchaseOrderUpdateInputDTO;
      try {
        dto = new SupplierPurchaseOrderUpdateInputDTO(req.body).build();
      } catch (e) {
        return this.invalid(req, next, e);
      }
      this.send(
        res,
        await service.updatePurchaseOrder(companyId, req.params.uuid, dto),
      );
    } catch (err) {
      next(err);
    }
  }

  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.companyOf(req, res);
      if (companyId === null) return;
      const result = await service.deletePurchaseOrder(
        companyId,
        req.params.uuid,
      );
      if (!result.ok) return this.send(res, result);
      res
        .status(200)
        .json({
          success: true,
          message: "Purchase order deleted successfully",
        });
    } catch (err) {
      next(err);
    }
  }

  public async sendOrder(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.companyOf(req, res);
      if (companyId === null) return;
      await setAuditAction("supplier-order.send");
      this.send(
        res,
        await service.sendPurchaseOrder(
          companyId,
          req.params.uuid,
          req.user?.email ?? null,
        ),
      );
    } catch (err) {
      next(err);
    }
  }

  public async unsendOrder(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.companyOf(req, res);
      if (companyId === null) return;
      await setAuditAction("supplier-order.unsend");
      this.send(
        res,
        await service.unsendPurchaseOrder(companyId, req.params.uuid),
      );
    } catch (err) {
      next(err);
    }
  }

  public async createReceipt(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.companyOf(req, res);
      if (companyId === null) return;
      let dto: SupplierReceiptCreateInputDTO;
      try {
        dto = new SupplierReceiptCreateInputDTO(req.body).build();
      } catch (e) {
        return this.invalid(req, next, e);
      }
      await setAuditAction("supplier-order.receive");
      this.send(
        res,
        await service.registerReceipt(
          companyId,
          req.params.uuid,
          req.user?.email ?? "unknown",
          dto,
        ),
        201,
      );
    } catch (err) {
      next(err);
    }
  }

  public async closeLine(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.companyOf(req, res);
      if (companyId === null) return;
      await setAuditAction("supplier-order.close-line");
      this.send(
        res,
        await service.closeLine(
          companyId,
          req.params.uuid,
          req.user?.email ?? "unknown",
        ),
      );
    } catch (err) {
      next(err);
    }
  }
}
