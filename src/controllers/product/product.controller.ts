import { Request, Response, NextFunction } from "express";
import { AuditService } from "../../services/audit.service";
import { IBaseController } from "../../types.d";
import {
  paginationHelper,
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { ProductDAO } from "../../dao/product/product.dao";
import { CompanyDAO } from "../../dao/company/company.dao";
import { CustomerDAO } from "../../dao/customer/customer.dao";
import { ProductTypeDAO } from "../../dao/product-type/product-type.dao";
import { BoxTypeDAO } from "../../dao/box-type/box-type.dao";
import { IProduct } from "../../interfaces/product/product.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  ProductCreateInputDTO,
  ProductUpdateInputDTO,
} from "../../dto/input/product";
import { enforceCompanyFilter, getCompanyFilterUuid } from "../../utils/companyScope";
import KnexManager from "../../database/KnexConnection";
import { PartDAO } from "../../dao/part/part.dao";
import { RbacService } from "../../services/rbac.service";
import { PartController } from "../part/part.controller";
import { getIdByUuid } from "../../utils/foreignKeyResolver";

export class ProductController implements IBaseController {
  private _audit = new AuditService();

  /** Best-effort audit hook (audit_logs) — fire-and-forget. */
  private recordAudit(req: any, op: "Alta" | "Baja" | "Modificacion", entity: any): void {
    void this._audit.record(req, "Product", op, entity ?? null);
  }

  private _productDAO: ProductDAO = new ProductDAO();

  /**
   * Map-driven FK resolution (client sends UUIDs; numeric ids pass through
   * untouched for internal callers) — shared by create and update.
   * Returns false when it already responded with a 400.
   */
  private async resolveProductRefs(data: any, res: Response): Promise<boolean> {
    const resolvers: Array<{
      key: "customerId" | "productTypeId" | "boxTypeId";
      dao: { getIdByUuid(uuid: string): Promise<number | null> };
      label: string;
    }> = [
      { key: "customerId", dao: new CustomerDAO(), label: "customer" },
      { key: "productTypeId", dao: new ProductTypeDAO(), label: "product type" },
      { key: "boxTypeId", dao: new BoxTypeDAO(), label: "box type" },
    ];
    for (const { key, dao, label } of resolvers) {
      // Unselected optional dropdowns submit "" — that's "no value", not a ref;
      // left as-is it reaches the integer FK column and 400s (22P02).
      if (data[key] === "" || data[key] === null) {
        data[key] = null;
        continue;
      }
      if (data[key] && typeof data[key] === "string") {
        const numericId = await dao.getIdByUuid(data[key]);
        if (!numericId) {
          res.status(400).json({ success: false, message: `Invalid ${label}` });
          return false;
        }
        data[key] = numericId;
      }
    }
    return true;
  }

  /**
   * SuperAdmin: filters by companyId from query params.
   * Regular users: always filtered by their assigned company (enforced server-side).
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      enforceCompanyFilter(req);

      const result: IDataPaginator<IProduct> =
        await this._productDAO.getAllWithFilters(req);
      res.status(200).json(result);
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

      const companyId = getCompanyFilterUuid(req);

      const result = await this._productDAO.getByUuid(uuid, companyId);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Product not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;
      const user = req.user;
      if (!user) {
        res.status(401).json({ success: false, message: "Authentication required." });
        return;
      }

      let companyIdNumeric: number;

      if (user.role === "superAdmin") {
        if (!data.companyId) {
          res.status(400).json({
            success: false,
            message: "SuperAdmin must specify a company",
          });
          return;
        }
        const companyDAO = new CompanyDAO();
        const numericId =
          typeof data.companyId === "string"
            ? await companyDAO.getIdByUuid(data.companyId)
            : data.companyId;
        if (!numericId) {
          res.status(400).json({
            success: false,
            message: "Invalid company",
          });
          return;
        }
        companyIdNumeric = numericId;
      } else {
        // SECURITY: regular users' companyId is taken from JWT, never from the request body.
        if (!user.companyId) {
          res.status(400).json({
            success: false,
            message: "User must belong to a company to create products",
          });
          return;
        }
        const companyDAO = new CompanyDAO();
        const numericId = await companyDAO.getIdByUuid(user.companyId);
        if (!numericId) {
          res.status(400).json({
            success: false,
            message: "Invalid company",
          });
          return;
        }
        companyIdNumeric = numericId;
      }

      data.companyId = companyIdNumeric;

      if (!(await this.resolveProductRefs(data, res))) return;

      const inputDTO = new ProductCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // SECURITY: uuid is generated server-side; never trust client-supplied uuids.
      const dataToCreate: IProduct = {
        uuid: uuidv4(),
        companyId: inputDTO.companyId,
        code: inputDTO.code,
        clientCode: inputDTO.clientCode,
        description: inputDTO.description,
        customerId: inputDTO.customerId,
        revision: inputDTO.revision,
        vip: inputDTO.vip,
        productTypeId: inputDTO.productTypeId,
        boxTypeId: inputDTO.boxTypeId,
        technicalSheetFileUuid: inputDTO.technicalSheetFileUuid,
        blueprintFileUuid: inputDTO.blueprintFileUuid,
        sketchFileUuid: inputDTO.sketchFileUuid,
        imageFileUuid: inputDTO.imageFileUuid,
      };

      const result = await this._productDAO.create(dataToCreate);

      // Simple-product atomic create (module 06 ProductoSimpleForm): an
      // optional initialPart is created right after the product; a part
      // failure rolls the product back so no partless "simple" product is
      // left behind. The part inherits the product's description when the
      // client didn't provide one; its code derives as {producto}/1.
      let initialPart: any = null;
      if (data.initialPart !== undefined && data.initialPart !== null) {
        const productId = await getIdByUuid(result.uuid!, "products");
        let outcome:
          | Awaited<ReturnType<PartController["createPartFromInput"]>>
          | null = null;
        let partError: any = null;
        if (productId) {
          const partController = new PartController();
          const partBody = {
            ...data.initialPart,
            productUuid: result.uuid,
            description: data.initialPart.description ?? inputDTO.description,
          };
          try {
            outcome = await partController.createPartFromInput(
              partBody,
              companyIdNumeric,
              productId,
              req.user?.email ?? null,
            );
          } catch (err) {
            partError = err;
          }
        }
        if (!outcome || !outcome.ok) {
          // The compensating delete must ALWAYS run — including when the id
          // lookup itself failed (a partless "simple" product must not survive).
          if (productId) {
            await this._productDAO.delete(productId);
          } else {
            await KnexManager.getConnection()("products")
              .where("uuid", result.uuid)
              .delete();
          }
          if (partError) throw partError;
          if (!productId) {
            throw new Error("Product id resolution failed during simple-product create");
          }
          res.status((outcome as any)?.status ?? 400).json({
            success: false,
            message: `Initial part: ${(outcome as any)?.message ?? "creation failed"}`,
          });
          return;
        }
        initialPart = outcome.part;
      }

      this.recordAudit(req, "Alta", result);

      res.status(201).json({
        success: true,
        data: initialPart ? { ...result, initialPart } : result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      const companyId = getCompanyFilterUuid(req);

      // companyId scope doubles as ownership check (404 if not in user's company).
      const existingId = await this._productDAO.getIdByUuid(uuid, companyId);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Product not found",
        });
        return;
      }

      if (!(await this.resolveProductRefs(data, res))) return;

      const inputDTO = new ProductUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._productDAO.update(existingId, inputDTO);

      this.recordAudit(req, "Modificacion", result);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const companyId = getCompanyFilterUuid(req);

      // companyId scope doubles as ownership check (404 if not in user's company).
      const existingId = await this._productDAO.getIdByUuid(uuid, companyId);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Product not found",
        });
        return;
      }

      const result = await this._productDAO.delete(existingId);

      if (result) this.recordAudit(req, "Baja", { uuid: req.params.uuid });

      if (result) {
        res.status(200).json({
          success: true,
          message: "Product deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete product",
        });
      }
    } catch (err: any) {
      // PostgreSQL foreign-key violation: surface a user-friendly 400 instead of leaking the FK error.
      if (
        err.code === "23503" ||
        err.message?.includes("foreign key constraint")
      ) {
        res.status(400).json({
          success: false,
          message:
            "Cannot delete product: it is referenced by other records. Please remove related data first.",
        });
        return;
      }
      next(err);
    }
  }

  public async getWithDetails(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const companyId = getCompanyFilterUuid(req);

      const result = await this._productDAO.getWithDetails(uuid, companyId);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Product not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * PATCH /product/:uuid/approval — { action: 'approve' | 'cancel' }.
   * Pair semantics per module 06 §04: approve clears cancellation and vice
   * versa; the acting user's email is stored as a denormalized snapshot.
   * With { cascade: true }, the action propagates to the product's parts
   * (the confirm dialog drives the flag — 04-state-and-lifecycle cascade).
   */
  public async setApproval(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const { action } = req.body;
      if (action !== "approve" && action !== "cancel") {
        res.status(400).json({
          success: false,
          message: "action must be 'approve' or 'cancel'",
        });
        return;
      }

      const companyId = getCompanyFilterUuid(req);
      const existingId = await this._productDAO.getIdByUuid(uuid, companyId);
      if (!existingId) {
        res.status(404).json({ success: false, message: "Product not found" });
        return;
      }

      const username = req.user?.email ?? "unknown";
      const knex = KnexManager.getConnection();

      // Cascade to parts (04-state-and-lifecycle): approving/cancelling the
      // product propagates to its parts' FINAL machine when the client
      // confirms (cascade: true).
      let cascaded = 0;
      let result: any;
      if (req.body?.cascade === true) {
        // AUTHZ: the cascade writes the parts' final approval machine — the
        // same write /parts gates behind parts.approve.part. Require it here
        // too (superAdmin bypasses; legacy roleless admins fall back).
        const user = req.user;
        if (
          !user ||
          !(await RbacService.userHasPermission(
            user.userId,
            user.role,
            "parts.approve.part",
          ))
        ) {
          res.status(403).json({
            success: false,
            message: "Insufficient permissions. Required: parts.approve.part",
          });
          return;
        }

        const partCount = await knex("parts")
          .where("productId", existingId)
          .count("* as count")
          .first();
        if (parseInt(partCount?.count as string, 10) > 500) {
          res.status(400).json({
            success: false,
            message:
              "Cascade limited to 500 parts per operation. Approve parts in bulk from the parts list instead.",
          });
          return;
        }

        const partDAO = new PartDAO();
        // One transaction, spec order (06 §04): parts first, product LAST —
        // a failed part approval must not leave an approved product behind.
        // Approve targets un-approved parts; cancel targets approved parts
        // only (PENDING parts stay pending).
        result = await knex.transaction(async (trx: any) => {
          const ids = await partDAO.cascadeApprovalTrx(
            trx,
            existingId,
            action,
            username,
          );
          cascaded = ids.length;
          return this._productDAO.setApproval(existingId, action, username, trx);
        });
      } else {
        result = await this._productDAO.setApproval(existingId, action, username);
      }

      this.recordAudit(req, "Modificacion", { ...(result as any), cascaded });

      res.status(200).json({ success: true, data: result, cascaded });
    } catch (err: any) {
      next(err);
    }
  }
}
