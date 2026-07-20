import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { DeliveryZoneDAO } from "../../dao/delivery-zone/delivery-zone.dao";
import { IDeliveryZone } from "../../interfaces/delivery/delivery.interfaces";
import {
  DeliveryZoneCreateInputDTO,
  DeliveryZoneUpdateInputDTO,
} from "../../dto/input/delivery";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import { getCompanyForCreate } from "../../utils/companyScope";

/** ZonasEntrega — a plain per-company maestro (module 16 §8). */
export class DeliveryZoneController extends BaseCrudController<IDeliveryZone> {
  protected dao = new DeliveryZoneDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Delivery zone",
    fkCatchOnDelete: true,
    fkCatchMessage:
      "Cannot delete delivery zone: delivery locations still reference it.",
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new DeliveryZoneCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }

  protected async buildUpdateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new DeliveryZoneUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }

  protected async beforeCreate(
    inputDTO: any,
    req: Request,
    res: Response,
  ): Promise<any | null> {
    const company = getCompanyForCreate(req);
    if (!company.success) {
      res.status(400).json({ success: false, message: company.message });
      return null;
    }
    const companyId = await getIdByUuid(company.companyUuid, "companies");
    if (!companyId) {
      res.status(400).json({ success: false, message: "Company not found" });
      return null;
    }
    return { ...inputDTO, companyId };
  }
}
