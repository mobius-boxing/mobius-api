import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { StoreOrderDAO } from "../../dao/store-order/store-order.dao";
import { CompanyDAO } from "../../dao/company/company.dao";
import {
  STORE_ORDER_STATUSES,
  StoreOrderStatus,
  IStoreOrderWithItems,
} from "../../interfaces/store-order/store-order.interfaces";
import { StoreOrderStatusInputDTO } from "../../dto/input/storeOrder";
import { getCompanyScope, enforceCompanyFilter } from "../../utils/companyScope";

/**
 * Admin order-management surface (backoffice). Mirrors the store-users admin
 * surface: internal auth + requireAdmin + requireStoreModule, strict company
 * scope. Every DAO call is company-scoped, so a record not in the resolved
 * company returns null → 404 (never reveal cross-company existence).
 */
export class StoreOrdersController {
  private _dao = new StoreOrderDAO();
  private _companyDAO = new CompanyDAO();

  /**
   * Resolve the numeric companyId from scope.
   * superAdmin → ?companyId / body companyId UUID; admin → JWT company UUID.
   * Returns null if there is no company context or the UUID does not resolve.
   */
  private async resolveCompanyId(req: Request): Promise<number | null> {
    const scope = getCompanyScope(req);
    if (!scope.companyUuid) return null;
    return this._companyDAO.getIdByUuid(scope.companyUuid);
  }

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      enforceCompanyFilter(req); // force JWT company for non-superAdmins
      const companyId = await this.resolveCompanyId(req);
      if (companyId === null) {
        res
          .status(400)
          .json({ success: false, message: "Company context required." });
        return;
      }

      const orders = await this._dao.getAllForCompany(companyId);
      res.status(200).json({
        success: true,
        data: orders.map((o) => ({
          uuid: o.uuid,
          status: o.status,
          createdAt: o.createdAt,
          itemCount: o.itemCount,
          storeUserEmail: o.storeUserEmail ?? null,
          notes: o.notes ?? null,
        })),
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const companyId = await this.resolveCompanyId(req);
      if (companyId === null) {
        res
          .status(400)
          .json({ success: false, message: "Company context required." });
        return;
      }

      const order = await this._dao.getByUuid(uuid, companyId); // company-scoped
      if (!order) {
        res.status(404).json({ success: false, message: "Order not found" });
        return;
      }
      res.status(200).json({ success: true, data: this.toOrderDTO(order) });
    } catch (err: any) {
      next(err);
    }
  }

  public async updateStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const inputDTO = new StoreOrderStatusInputDTO(req.body).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }
      if (
        !STORE_ORDER_STATUSES.includes(inputDTO.status as StoreOrderStatus)
      ) {
        res.status(400).json({ success: false, message: "Invalid status" });
        return;
      }

      const companyId = await this.resolveCompanyId(req);
      if (companyId === null) {
        res
          .status(400)
          .json({ success: false, message: "Company context required." });
        return;
      }

      const updated = await this._dao.updateStatus(
        uuid,
        companyId,
        inputDTO.status as StoreOrderStatus,
      );
      if (!updated) {
        res.status(404).json({ success: false, message: "Order not found" });
        return;
      }
      res.status(200).json({ success: true, data: this.toOrderDTO(updated) });
    } catch (err: any) {
      next(err);
    }
  }

  // UUID-only output mapper. Never exposes numeric ids / foreign keys.
  // buyer email (storeUserEmail) is allowed — same-company admins manage the order.
  private toOrderDTO(o: IStoreOrderWithItems) {
    return {
      uuid: o.uuid,
      status: o.status,
      notes: o.notes ?? null,
      createdAt: o.createdAt,
      storeUserEmail: o.storeUserEmail ?? null,
      items: (o.items ?? []).map((i) => ({
        uuid: i.uuid,
        itemType: i.itemType,
        sourceUuid: i.sourceUuid ?? null,
        description: i.description,
        quantity: i.quantity,
        unitsPerPallet: i.unitsPerPallet ?? null,
      })),
    };
  }
}
