import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { StoreOrderDAO } from "../../dao/store-order/store-order.dao";
import { StoreBoxDAO } from "../../dao/store-box/store-box.dao";
import { StoreRollDAO } from "../../dao/store-roll/store-roll.dao";
import { StoreUserDAO } from "../../dao/store-user/store-user.dao";
import { CompanyDAO } from "../../dao/company/company.dao";
import { StoreOrderCreateInputDTO } from "../../dto/input/storeOrder";
import { getStoreOrderLimits } from "../../services/store/store-order-limits";
import {
  IStoreOrderItem,
  IStoreOrderWithItems,
} from "../../interfaces/store-order/store-order.interfaces";

export class StoreOrderController {
  private _orderDAO = new StoreOrderDAO();
  private _boxDAO = new StoreBoxDAO();
  private _rollDAO = new StoreRollDAO();
  private _storeUserDAO = new StoreUserDAO();
  private _companyDAO = new CompanyDAO();

  /**
   * POST /api/store/orders — AUTHENTICATED. Transactional (DAO owns the transaction).
   * Validates each item against the JWT company's ACTIVE catalog, snapshots descriptions
   * (+ unitsPerPallet for boxes), enforces the unambiguous order rules, then persists.
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const bad = (msg: string): void => {
        res.status(400).json({ success: false, message: msg });
      };

      const inputDTO = new StoreOrderCreateInputDTO(req.body).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      if (!Array.isArray(inputDTO.items) || inputDTO.items.length === 0) {
        return bad("Order must contain at least one item");
      }

      // Resolve numeric ids from the JWT UUIDs (scope = JWT company only).
      const companyId = await this._companyDAO.getIdByUuid(
        req.storeUser!.companyId,
      );
      const storeUser = await this._storeUserDAO.getByUuid(
        req.storeUser!.storeUserId,
      );
      if (!companyId || !storeUser?.id) {
        return bad("Invalid session");
      }

      const limits = await getStoreOrderLimits(companyId);

      const resolvedItems: IStoreOrderItem[] = [];
      const boxUuids = new Set<string>();

      for (const it of inputDTO.items) {
        if (it.itemType !== "box" && it.itemType !== "roll") {
          return bad("Invalid item type");
        }
        if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
          return bad("Quantity must be a positive integer");
        }
        if (typeof it.sourceUuid !== "string" || !it.sourceUuid) {
          return bad("sourceUuid is required");
        }

        if (it.itemType === "box") {
          const box = await this._boxDAO.getByUuid(it.sourceUuid);
          // SECURITY: getByUuid is NOT company-scoped — assert company equality
          // here. Generic message (no cross-company vs not-found distinction) to
          // prevent catalog enumeration across tenants.
          if (!box || box.companyId !== companyId || box.isActive !== true) {
            return bad("Invalid or unavailable catalog item");
          }
          if (boxUuids.has(it.sourceUuid)) {
            return bad("Duplicate box item");
          }
          boxUuids.add(it.sourceUuid);

          const minUnits = limits.minPalletsPerBoxMeasure * box.unitsPerPallet;
          if (it.quantity < minUnits) {
            return bad(
              `Box ${box.description} requires at least ${limits.minPalletsPerBoxMeasure} pallets (${minUnits} units)`,
            );
          }
          // TODO(store-limits): max total box units cap — store.md §5 is ambiguous;
          // enforce sum(boxItem.quantity) <= limits.maxTotalBoxUnits only when the
          // config field exists. NOT enforced in v1.

          resolvedItems.push({
            itemType: "box",
            sourceUuid: box.uuid ?? null, // snapshot the catalog uuid
            description: box.description, // snapshot
            quantity: it.quantity,
            unitsPerPallet: box.unitsPerPallet, // snapshot (boxes only)
          });
        } else {
          const roll = await this._rollDAO.getByUuid(it.sourceUuid);
          if (!roll || roll.companyId !== companyId || roll.isActive !== true) {
            return bad("Invalid or unavailable catalog item");
          }
          const minQuantity = roll.minQuantity ?? 0;
          if (it.quantity < minQuantity) {
            return bad(
              `Roll ${roll.description} requires at least ${minQuantity} units`,
            );
          }

          resolvedItems.push({
            itemType: "roll",
            sourceUuid: roll.uuid ?? null,
            description: roll.description, // snapshot
            quantity: it.quantity,
            unitsPerPallet: null, // rolls have none
          });
        }
      }

      if (boxUuids.size > limits.maxBoxMeasures) {
        return bad(
          `At most ${limits.maxBoxMeasures} distinct box measures per order`,
        );
      }

      // DAO owns the transaction (order + items inserted atomically).
      const created = await this._orderDAO.create(
        {
          companyId,
          storeUserId: storeUser.id,
          notes: inputDTO.notes,
        },
        resolvedItems,
      );

      res.status(201).json({ success: true, data: this.toOrderDTO(created) });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * GET /api/store/orders — AUTHENTICATED. The store user's own orders, newest first.
   * Returns a plain array of list-shaped items.
   */
  public async list(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = await this._companyDAO.getIdByUuid(
        req.storeUser!.companyId,
      );
      const storeUser = await this._storeUserDAO.getByUuid(
        req.storeUser!.storeUserId,
      );
      if (!companyId || !storeUser?.id) {
        res.status(401).json({ success: false, message: "Unauthorized" });
        return;
      }

      const orders = await this._orderDAO.getAllForStoreUser(
        storeUser.id,
        companyId,
      );

      res.status(200).json({
        success: true,
        data: orders.map((o) => ({
          uuid: o.uuid,
          status: o.status,
          createdAt: o.createdAt,
          itemCount: o.itemCount,
        })),
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * GET /api/store/orders/:uuid — AUTHENTICATED.
   * Double scoping: company-scope at the DAO (getByUuid(uuid, companyId)) AND
   * ownership-scope in the controller. Any mismatch → 404 (never reveal existence).
   */
  public async getOne(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const companyId = await this._companyDAO.getIdByUuid(
        req.storeUser!.companyId,
      );
      const storeUser = await this._storeUserDAO.getByUuid(
        req.storeUser!.storeUserId,
      );
      if (!companyId || !storeUser?.id) {
        res.status(401).json({ success: false, message: "Unauthorized" });
        return;
      }

      const order = await this._orderDAO.getByUuid(uuid, companyId);
      if (!order) {
        res.status(404).json({ success: false, message: "Order not found" });
        return;
      }

      // Ownership scope — never reveal another user's order in the same company.
      if (order.storeUserId !== storeUser.id) {
        res.status(404).json({ success: false, message: "Order not found" });
        return;
      }

      res.status(200).json({ success: true, data: this.toOrderDTO(order) });
    } catch (err: any) {
      next(err);
    }
  }

  // UUID-only output mapper. Never exposes numeric ids / foreign keys.
  private toOrderDTO(o: IStoreOrderWithItems) {
    return {
      uuid: o.uuid,
      status: o.status,
      notes: o.notes ?? null,
      createdAt: o.createdAt,
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
