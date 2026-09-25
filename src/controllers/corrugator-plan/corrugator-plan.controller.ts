import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import * as planService from "../../services/corrugator/plan.service";
import type { ServiceResult } from "../../services/corrugator/plan.service";
import {
  CorrugatorPlanCreateInputDTO,
  CorrugatorPlanUpdateInputDTO,
  CorrugatorPlanOrdersCreateInputDTO,
  CorrugatorPlanOrderUpdateInputDTO,
  CorrugatorCombinationCreateInputDTO,
  CorrugatorCombinationUpdateInputDTO,
  CorrugatorRegisterInputDTO,
} from "../../dto/corrugator-plan";

/**
 * `/api/corrugator-plans` — hand-rolled (atomic multi-entity writes,
 * non-CRUD verbs; not `BaseCrudController`), still `IBaseController`-shaped
 * where it matters. All business logic lives in `plan.service.ts`; this stays
 * a thin req/res translation of its `ServiceResult<T>`.
 */
export class CorrugatorPlanController {
  private requireCompanyId(req: Request, res: Response): number | null {
    if (req.companyId === undefined) {
      res
        .status(400)
        .json({ success: false, message: "A company is required" });
      return null;
    }
    return req.companyId;
  }

  private sendResult(
    res: Response,
    result: ServiceResult<unknown>,
    successStatus = 200,
  ): void {
    if (!result.ok) {
      res.status(result.status).json({
        success: false,
        message: result.message,
        ...(result.code ? { code: result.code } : {}),
        ...(result.details ?? {}),
      });
      return;
    }
    res.status(successStatus).json({ success: true, data: result.data });
  }

  private async buildDTO<T extends { build(): T }>(
    req: Request,
    res: Response,
    next: NextFunction,
    ctor: new (data: unknown) => T,
  ): Promise<T | null> {
    let dto: T;
    try {
      dto = new ctor(req.body).build();
    } catch (e: any) {
      req.statusCode = 400;
      next(new Error(e.message));
      return null;
    }
    const validation: IInputValidator = await inputValidator(dto as any);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return dto;
  }

  public async getPool(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      const search =
        typeof req.query.search === "string" ? req.query.search : undefined;
      const data = await planService.getPool(companyId, search);
      res.status(200).json({ success: true, data });
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
      const result = await planService.listPlans(req);
      res.status(200).json(result);
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
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      const dto = await this.buildDTO(
        req,
        res,
        next,
        CorrugatorPlanCreateInputDTO,
      );
      if (!dto) return;
      const result = await planService.createPlan(
        companyId,
        req.user?.email ?? null,
        dto,
      );
      this.sendResult(res, result, 201);
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
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      const data = await planService.getPlanDetail(companyId, req.params.uuid);
      if (!data) {
        res.status(404).json({ success: false, message: "Plan not found" });
        return;
      }
      res.status(200).json({ success: true, data });
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
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      const dto = await this.buildDTO(
        req,
        res,
        next,
        CorrugatorPlanUpdateInputDTO,
      );
      if (!dto) return;
      const result = await planService.updatePlan(
        companyId,
        req.params.uuid,
        dto,
      );
      this.sendResult(res, result);
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
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      const result = await planService.deletePlan(companyId, req.params.uuid);
      if (!result.ok) {
        this.sendResult(res, result);
        return;
      }
      res
        .status(200)
        .json({ success: true, message: "Plan deleted successfully" });
    } catch (err) {
      next(err);
    }
  }

  public async addOrders(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      const dto = await this.buildDTO(
        req,
        res,
        next,
        CorrugatorPlanOrdersCreateInputDTO,
      );
      if (!dto) return;
      const result = await planService.addOrders(
        companyId,
        req.params.uuid,
        dto.productionOrderUuids,
      );
      this.sendResult(res, result, 201);
    } catch (err) {
      next(err);
    }
  }

  public async updateOrder(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      const dto = await this.buildDTO(
        req,
        res,
        next,
        CorrugatorPlanOrderUpdateInputDTO,
      );
      if (!dto) return;
      const result = await planService.updateOrderLine(
        companyId,
        req.params.uuid,
        req.params.orderUuid,
        dto,
      );
      this.sendResult(res, result);
    } catch (err) {
      next(err);
    }
  }

  public async deleteOrder(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      const result = await planService.deleteOrderLine(
        companyId,
        req.params.uuid,
        req.params.orderUuid,
      );
      if (!result.ok) {
        this.sendResult(res, result);
        return;
      }
      res.status(200).json({ success: true, message: "Line removed" });
    } catch (err) {
      next(err);
    }
  }

  public async solve(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      const result = await planService.startSolve(companyId, req.params.uuid);
      this.sendResult(res, result, 202);
    } catch (err) {
      next(err);
    }
  }

  public async cancelSolve(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      const result = await planService.cancelSolve(companyId, req.params.uuid);
      this.sendResult(res, result);
    } catch (err) {
      next(err);
    }
  }

  public async candidates(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      const orderUuid =
        typeof req.query.orderUuid === "string"
          ? req.query.orderUuid
          : undefined;
      if (!orderUuid) {
        res
          .status(400)
          .json({ success: false, message: "orderUuid is required" });
        return;
      }
      const machineUuid =
        typeof req.query.machineUuid === "string"
          ? req.query.machineUuid
          : undefined;
      const result = await planService.getCandidates(
        companyId,
        req.params.uuid,
        orderUuid,
        machineUuid,
      );
      this.sendResult(res, result);
    } catch (err) {
      next(err);
    }
  }

  public async addCombination(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      const dto = await this.buildDTO(
        req,
        res,
        next,
        CorrugatorCombinationCreateInputDTO,
      );
      if (!dto) return;
      const result = await planService.addCombination(
        companyId,
        req.params.uuid,
        dto,
      );
      this.sendResult(res, result, 201);
    } catch (err) {
      next(err);
    }
  }

  public async updateCombination(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      const dto = await this.buildDTO(
        req,
        res,
        next,
        CorrugatorCombinationUpdateInputDTO,
      );
      if (!dto) return;
      const result = await planService.updateCombination(
        companyId,
        req.params.uuid,
        req.params.cuuid,
        dto,
      );
      this.sendResult(res, result);
    } catch (err) {
      next(err);
    }
  }

  public async deleteCombination(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      const result = await planService.deleteCombination(
        companyId,
        req.params.uuid,
        req.params.cuuid,
      );
      this.sendResult(res, result);
    } catch (err) {
      next(err);
    }
  }

  public async deleteItem(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      const result = await planService.deleteItem(
        companyId,
        req.params.uuid,
        req.params.cuuid,
        req.params.iuuid,
      );
      this.sendResult(res, result);
    } catch (err) {
      next(err);
    }
  }

  public async register(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      // Every field of this DTO is optional — an empty `{}` body is the
      // common case (plain register), and `inputValidator` rejects empty
      // objects outright, so it is skipped here (unlike `buildDTO`'s other
      // callers, whose DTOs always have at least one required field).
      let dto: CorrugatorRegisterInputDTO;
      try {
        dto = new CorrugatorRegisterInputDTO(req.body).build();
      } catch (e: any) {
        req.statusCode = 400;
        next(new Error(e.message));
        return;
      }
      const result = await planService.register(
        companyId,
        req.params.uuid,
        req.user?.email ?? null,
        !!dto.force,
      );
      this.sendResult(res, result);
    } catch (err) {
      next(err);
    }
  }

  public async unregister(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyId = this.requireCompanyId(req, res);
      if (companyId === null) return;
      const result = await planService.unregister(companyId, req.params.uuid);
      this.sendResult(res, result);
    } catch (err) {
      next(err);
    }
  }
}
