import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { setAuditAction } from "../../database/audit-context";
import { QuotationDAO } from "../../dao/quotation/quotation.dao";
import { SalesOrderDAO } from "../../dao/sales-order/sales-order.dao";
import { ProductionOrderGenerationService } from "../../services/production-order-generation.service";
import { OrderDeliveryService } from "../../services/order-delivery.service";
import { RbacService } from "../../services/rbac.service";
import { IPromisedQuantity } from "../../interfaces/production-order/production-order.interfaces";
import { IDeliveryRow } from "../../interfaces/order-delivery/order-delivery.interfaces";
import {
  ORDER_APPROVAL_MACHINES,
  orderApprovalPermissionCode,
} from "../../interfaces/sales-order/sales-order-approval.interfaces";
import { CoreClient } from "../../services/core-client.service";
import {
  IGenerateOrderResult,
  IQuotationRow,
} from "../../interfaces/quotation/quotation.interfaces";
import {
  QuotationApprovalInputDTO,
  QuotationCreateInputDTO,
  QuotationGenerateOrderInputDTO,
  QuotationUpdateInputDTO,
} from "../../dto/input/quotation";

/**
 * `/api/quotations` — hand-rolled rather than `BaseCrudController`: the
 * generate-order verb writes two entities and the approval/ordered guards
 * (I-4, C-8) sit between a read and every write. Every lookup is scoped to the
 * caller's `req.companyId` (L-009); a uuid of another company is a 404.
 */
export class QuotationController {
  private dao = new QuotationDAO();
  private salesOrders = new SalesOrderDAO();
  private generation = new ProductionOrderGenerationService();
  private deliveries = new OrderDeliveryService();

  private companyOf(req: Request, res: Response): number | null {
    if (req.companyId === undefined) {
      res
        .status(400)
        .json({ success: false, message: "A company is required" });
      return null;
    }
    return req.companyId;
  }

  private fail(
    res: Response,
    status: number,
    message: string,
    code?: string,
  ): void {
    res
      .status(status)
      .json({ success: false, message, ...(code ? { code } : {}) });
  }

  private invalid(req: Request, next: NextFunction, e: unknown): void {
    req.statusCode = 400;
    next(new Error(e instanceof Error ? e.message : "Invalid request"));
  }

  /** The row, or a written 404. */
  private async loadRow(
    req: Request,
    res: Response,
    companyId: number,
  ): Promise<IQuotationRow | null> {
    const row = await this.dao.getRowByUuid(req.params.uuid, companyId);
    if (!row) this.fail(res, 404, "Quotation not found");
    return row;
  }

  /** `undefined` = not sent, `null` = cleared, `false` = a 404 was written. */
  private async resolveSalesUser(
    uuid: string | null | undefined,
    companyId: number,
    res: Response,
  ): Promise<number | null | undefined | false> {
    if (uuid === undefined) return undefined;
    if (uuid === null) return null;
    const userId = await CoreClient.userIdByUuid(uuid);
    const [user] = userId ? await CoreClient.usersByIds([userId]) : [];
    if (!user || user.companyId !== companyId) {
      this.fail(res, 404, "Sales user not found");
      return false;
    }
    return user.id;
  }

  /** `undefined` = not sent, `false` = a 400 was written. */
  private async resolveDeliveries(
    inputs: Parameters<OrderDeliveryService["resolve"]>[0] | undefined,
    customerId: number,
    companyId: number,
    res: Response,
  ): Promise<IDeliveryRow[] | undefined | false> {
    if (inputs === undefined) return undefined;
    const resolved = await this.deliveries.resolve(
      inputs,
      customerId,
      companyId,
    );
    if (!resolved.ok) {
      this.fail(res, 400, resolved.message);
      return false;
    }
    return resolved.rows;
  }

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.companyOf(req, res);
      if (companyId === null) return;
      res.status(200).json(await this.dao.getAllWithFilters(req, companyId));
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
      const data = await this.dao.getByUuid(req.params.uuid, companyId);
      if (!data) return this.fail(res, 404, "Quotation not found");
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
      let dto: QuotationCreateInputDTO;
      try {
        dto = new QuotationCreateInputDTO(req.body).build();
      } catch (e) {
        return this.invalid(req, next, e);
      }

      const refs = await this.dao.resolveReferences(
        companyId,
        dto.customerUuid!,
        dto.productUuid!,
      );
      if (!refs.ok) {
        if (refs.missing === "pairing") {
          return this.fail(
            res,
            400,
            "Product does not belong to the selected customer",
          );
        }
        return this.fail(
          res,
          404,
          `${refs.missing === "customer" ? "Customer" : "Product"} not found`,
        );
      }
      const salesUserId = await this.resolveSalesUser(
        dto.salesUserUuid,
        companyId,
        res,
      );
      if (salesUserId === false) return;
      const deliveryRows = await this.resolveDeliveries(
        dto.deliveries,
        refs.customerId,
        companyId,
        res,
      );
      if (deliveryRows === false) return;

      const uuid = uuidv4();
      await this.dao.create(
        {
          uuid,
          companyId,
          number: await this.dao.nextNumber(companyId),
          customerId: refs.customerId,
          productId: refs.productId,
          quantity: dto.quantity,
          price: dto.price,
          deliveryDate: dto.deliveryDate ?? null,
          salesUserId: salesUserId ?? null,
          notes: dto.notes ?? null,
          status: dto.status,
          createdByUser: req.user?.email ?? null,
        },
        deliveryRows,
      );
      res.status(201).json({
        success: true,
        data: await this.dao.getByUuid(uuid, companyId),
      });
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
      const row = await this.loadRow(req, res, companyId);
      if (!row) return;
      if (row.salesOrderId !== null) {
        return this.fail(
          res,
          409,
          "The quotation already generated an order",
          "QUOTATION_ORDERED",
        );
      }
      let dto: QuotationUpdateInputDTO;
      try {
        dto = new QuotationUpdateInputDTO(req.body).build();
      } catch (e) {
        return this.invalid(req, next, e);
      }

      // NoEditarAprobados: an approved quotation only accepts a status change.
      const editsMoreThanStatus = [
        dto.customerUuid,
        dto.productUuid,
        dto.quantity,
        dto.price,
        dto.deliveryDate,
        dto.salesUserUuid,
        dto.notes,
        dto.deliveries,
      ].some((v) => v !== undefined);
      if (row.approvedAt !== null && editsMoreThanStatus) {
        return this.fail(
          res,
          409,
          "An approved quotation cannot be edited",
          "QUOTATION_APPROVED",
        );
      }

      const stored = await this.dao.getByUuid(req.params.uuid, companyId);
      const sameUuid = (a?: string, b?: string) =>
        a === undefined || a.toLowerCase() === (b ?? "").toLowerCase();
      if (!sameUuid(dto.customerUuid, stored?.customer?.uuid)) {
        return this.fail(res, 400, "Customer cannot be changed");
      }
      if (!sameUuid(dto.productUuid, stored?.product?.uuid)) {
        return this.fail(res, 400, "Product cannot be changed");
      }
      const salesUserId = await this.resolveSalesUser(
        dto.salesUserUuid,
        companyId,
        res,
      );
      if (salesUserId === false) return;
      const deliveryRows = await this.resolveDeliveries(
        dto.deliveries,
        row.customerId,
        companyId,
        res,
      );
      if (deliveryRows === false) return;

      const patch = {
        quantity: dto.quantity,
        price: dto.price,
        deliveryDate: dto.deliveryDate,
        salesUserId,
        notes: dto.notes,
        status: dto.status,
      };
      if (
        Object.values(patch).every((v) => v === undefined) &&
        deliveryRows === undefined
      ) {
        return this.fail(res, 400, "No updatable field was sent");
      }
      await this.dao.update(
        row.id,
        patch,
        deliveryRows !== undefined
          ? { companyId, rows: deliveryRows }
          : undefined,
      );
      // C-8: a rejected quotation cannot stay approved.
      if (dto.status === "rejected" && row.approvedAt !== null) {
        await this.dao.setApproval(row.id, false, null);
      }
      res.status(200).json({
        success: true,
        data: await this.dao.getByUuid(req.params.uuid, companyId),
      });
    } catch (err) {
      next(err);
    }
  }

  public async setApproval(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.companyOf(req, res);
      if (companyId === null) return;
      let dto: QuotationApprovalInputDTO;
      try {
        dto = new QuotationApprovalInputDTO(req.body).build();
      } catch (e) {
        return this.invalid(req, next, e);
      }
      const row = await this.loadRow(req, res, companyId);
      if (!row) return;
      if (row.salesOrderId !== null) {
        return this.fail(
          res,
          409,
          "The quotation already generated an order",
          "QUOTATION_ORDERED",
        );
      }
      if (dto.approved && row.status === "rejected") {
        return this.fail(
          res,
          409,
          "A rejected quotation cannot be approved",
          "QUOTATION_REJECTED",
        );
      }
      // Re-approving keeps the original stamp; only a state change writes.
      if (dto.approved !== (row.approvedAt !== null)) {
        await this.dao.setApproval(
          row.id,
          dto.approved,
          req.user?.email ?? null,
        );
      }
      res.status(200).json({
        success: true,
        data: await this.dao.getByUuid(req.params.uuid, companyId),
      });
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
      const row = await this.loadRow(req, res, companyId);
      if (!row) return;
      if (row.salesOrderId !== null) {
        return this.fail(
          res,
          409,
          "The quotation already generated an order",
          "QUOTATION_ORDERED",
        );
      }
      await this.dao.delete(row.id);
      res
        .status(200)
        .json({ success: true, message: "Quotation deleted successfully" });
    } catch (err) {
      next(err);
    }
  }

  /**
   * D-81: the same DAO function the approval endpoints call, acting as the
   * requesting user and only for approvals whose permission they hold. A
   * credit-limit override is never written; whatever stays unapproved is
   * reported by the generation guard as the existing warning.
   */
  private async autoApprove(
    req: Request,
    salesOrderId: number,
    salesOrderUuid: string,
    companyId: number,
    warnings: string[],
  ): Promise<void> {
    const user = req.user;
    if (!user) return;
    const order = await this.salesOrders.getByUuid(salesOrderUuid, companyId);
    if (!order) return;
    const done = {
      commercial: order.commerciallyApproved,
      financial: order.financiallyApproved,
    };
    for (const machine of ORDER_APPROVAL_MACHINES) {
      if (done[machine]) continue;
      const code = orderApprovalPermissionCode(machine)!;
      if (!(await RbacService.userHasPermission(user.userId, user.role, code)))
        continue;
      try {
        await setAuditAction("sales_order.approval");
        await this.salesOrders.setApproval(
          salesOrderId,
          machine,
          "approve",
          user.email ?? "unknown",
        );
      } catch (e) {
        warnings.push(
          `APPROVAL_FAILED: ${machine}: ${e instanceof Error ? e.message : "unknown error"}`,
        );
      }
    }
  }

  /**
   * D-77: one row per delivery of the sales order (resolved quantity, date);
   * one row (whole quantity, earliest date) under `oneOrderPerSalesOrder`;
   * the quotation's own quantity/date when there are no deliveries.
   */
  private async promisedQuantities(
    salesOrderUuid: string,
    companyId: number,
    fallback: { quantity: number; deliveryDate: string | null },
  ): Promise<IPromisedQuantity[]> {
    const order = await this.salesOrders.getByUuid(salesOrderUuid, companyId);
    const deliveries = order?.deliveries ?? [];
    if (!order || deliveries.length === 0) return [fallback];
    const iso = (d: Date) => new Date(d).toISOString();
    if ((await this.generation.loadConfig(companyId)).oneOrderPerSalesOrder) {
      const first = OrderDeliveryService.earliest(deliveries)!;
      return [
        {
          quantity: order.quantity ?? fallback.quantity,
          deliveryDate: iso(first.deliveryDate),
        },
      ];
    }
    return deliveries.map((d) => ({
      quantity: d.quantity,
      deliveryDate: iso(d.deliveryDate),
    }));
  }

  /**
   * D-27: step 1 (sales order + quotation link) is one transaction; step 2
   * (`ProductionOrderGenerationService.generate`, which owns its own) runs
   * after it. A step-2 failure answers 201 with `warnings` and leaves the
   * quotation `ordered`; calling again re-runs ONLY step 2.
   */
  public async generateOrder(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.companyOf(req, res);
      if (companyId === null) return;
      let dto: QuotationGenerateOrderInputDTO;
      try {
        dto = new QuotationGenerateOrderInputDTO(req.body).build();
      } catch (e) {
        return this.invalid(req, next, e);
      }
      const row = await this.loadRow(req, res, companyId);
      if (!row) return;

      let salesOrderId: number;
      let salesOrderUuid: string;
      let salesOrderNumber: string;

      if (row.salesOrderId !== null) {
        const existing = await this.dao.getLinkedOrderState(row.salesOrderId);
        if (!existing || existing.hasProductionOrders) {
          return this.fail(
            res,
            409,
            "The quotation already generated an order",
            "QUOTATION_ORDERED",
          );
        }
        salesOrderId = row.salesOrderId;
        salesOrderUuid = existing.uuid;
        salesOrderNumber = existing.number;
      } else {
        if (row.status === "rejected") {
          return this.fail(
            res,
            409,
            "A rejected quotation cannot generate an order",
            "QUOTATION_REJECTED",
          );
        }
        const customerSalesPersonId = await this.dao.getCustomerSalesPersonId(
          row.customerId,
          companyId,
        );

        let deliveryLocationId: number | undefined;
        if (dto.deliveryLocationUuid) {
          const location = await this.dao.resolveDeliveryLocation(
            dto.deliveryLocationUuid,
            companyId,
          );
          if (!location)
            return this.fail(res, 404, "Delivery location not found");
          if (location.customerId !== row.customerId) {
            return this.fail(
              res,
              400,
              "Delivery location does not belong to the selected customer",
            );
          }
          deliveryLocationId = location.id;
        }

        await setAuditAction("quotation.generate-order");
        const created = await this.salesOrders.create(
          {
            companyId,
            customerId: row.customerId,
            productId: row.productId,
            quantity: row.quantity,
            price: row.price,
            deliveryDate: (dto.deliveryDate ?? row.deliveryDate) as Date | null,
            purchaseOrder: dto.purchaseOrder,
            salesUserId: row.salesUserId ?? customerSalesPersonId,
            quotationId: row.id,
            deliveryRows: await this.deliveries.rowsOf({
              column: "quotationId",
              id: row.id,
            }),
            createdByUsername: req.user?.email ?? null,
            orderDataInput:
              deliveryLocationId !== undefined ? { deliveryLocationId } : {},
          },
          async (trx, order) => {
            const linked = await trx("quotations")
              .where({ id: row.id })
              .whereNull("salesOrderId")
              .update({
                salesOrderId: order.id,
                status: "accepted",
                updatedAt: trx.fn.now(),
              });
            if (linked === 0)
              throw new Error("Quotation was ordered concurrently");
          },
        );
        salesOrderId = created.id!;
        salesOrderUuid = created.uuid!;
        salesOrderNumber = created.number!;
      }

      const warnings: string[] = [];
      await this.autoApprove(
        req,
        salesOrderId,
        salesOrderUuid,
        companyId,
        warnings,
      );
      await setAuditAction("quotation.generate-order");

      const quotation = await this.dao.getByUuid(req.params.uuid, companyId);
      const delivery = dto.deliveryDate ?? row.deliveryDate;
      let productionOrders: IGenerateOrderResult["productionOrders"] = [];
      try {
        const outcome = await this.generation.generate({
          salesOrderUuid,
          promisedQuantities: await this.promisedQuantities(
            salesOrderUuid,
            companyId,
            {
              quantity: row.quantity,
              deliveryDate: delivery ? new Date(delivery).toISOString() : null,
            },
          ),
          force: false,
          username: req.user?.email ?? "unknown",
          companyScope: companyId,
        });
        if (outcome.ok) {
          productionOrders = outcome.generated.map((o) => ({
            uuid: o.uuid!,
            number: o.number!,
          }));
          warnings.push(...outcome.warnings);
        } else if (outcome.kind === "guard") {
          warnings.push(`${outcome.reason.code}: ${outcome.reason.message}`);
        } else if (outcome.kind === "invalid") {
          warnings.push(...outcome.problems.map((p) => `ORDER_INVALID: ${p}`));
        } else {
          warnings.push("SALES_ORDER_NOT_FOUND: Sales order not found");
        }
      } catch (e) {
        warnings.push(
          `GENERATION_FAILED: ${e instanceof Error ? e.message : "unknown error"}`,
        );
      }

      const result: IGenerateOrderResult = {
        quotation: quotation!,
        salesOrder: { uuid: salesOrderUuid, number: salesOrderNumber },
        productionOrders,
        warnings,
      };
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}
