import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { DeliveryLocationDAO } from "../../dao/delivery-location/delivery-location.dao";
import { DeliveryZoneDAO } from "../../dao/delivery-zone/delivery-zone.dao";
import { CustomerDAO } from "../../dao/customer/customer.dao";
import { IDeliveryLocation } from "../../interfaces/delivery/delivery.interfaces";
import {
  DeliveryLocationCreateInputDTO,
  DeliveryLocationUpdateInputDTO,
} from "../../dto/input/delivery";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";
import { getCompanyFilterUuid } from "../../utils/companyScope";

/**
 * LugaresDeEntrega — nested child of the Customer flow (module 16 §7).
 * The zone is REQUIRED at API level (§L.6) though the DB column is nullable
 * (ETL fidelity: legacy rows may lack a zone).
 */
export class DeliveryLocationController extends BaseCrudController<IDeliveryLocation> {
  protected dao = new DeliveryLocationDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Delivery location",
  };

  private zoneDAO = new DeliveryZoneDAO();
  private customerDAO = new CustomerDAO();

  protected async buildCreateDTO(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new DeliveryLocationCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    if (!inputDTO.customerUuid) {
      res
        .status(400)
        .json({ success: false, message: "customerUuid is required" });
      return null;
    }
    if (!inputDTO.deliveryZoneUuid) {
      res.status(400).json({
        success: false,
        message: "deliveryZoneUuid is required (create the zone first)",
      });
      return null;
    }
    return inputDTO;
  }

  protected async buildUpdateDTO(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new DeliveryLocationUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    // §L.6: the zone may be changed but never cleared via the API.
    if (
      (inputDTO as any).deliveryZoneUuid === null ||
      (inputDTO as any).deliveryZoneUuid === ""
    ) {
      res
        .status(400)
        .json({
          success: false,
          message: "deliveryZoneUuid cannot be cleared",
        });
      return null;
    }
    return inputDTO;
  }

  protected async beforeCreate(
    inputDTO: any,
    req: Request,
    res: Response,
  ): Promise<any | null> {
    const companyUuid = getCompanyFilterUuid(req);

    // Customer must exist and (for scoped callers) belong to the company.
    const customer = await this.customerDAO.getByUuid(
      inputDTO.customerUuid,
      companyUuid,
    );
    if (!customer || !(customer as any).id) {
      res.status(404).json({ success: false, message: "Customer not found" });
      return null;
    }

    const zoneId = await this.zoneDAO.getIdByUuid(
      inputDTO.deliveryZoneUuid,
      companyUuid,
    );
    if (!zoneId) {
      res
        .status(400)
        .json({ success: false, message: "Delivery zone not found" });
      return null;
    }

    return {
      address: inputDTO.address,
      schedule: inputDTO.schedule,
      latitude: inputDTO.latitude,
      longitude: inputDTO.longitude,
      externalSystemCode: inputDTO.externalSystemCode,
      customerId: (customer as any).id,
      companyId: (customer as any).companyId,
      deliveryZoneId: zoneId,
    };
  }

  protected async beforeUpdate(
    inputDTO: any,
    _existingId: number,
    req: Request,
    res: Response,
  ): Promise<any | null> {
    const updateData: any = { ...inputDTO };
    delete updateData.deliveryZoneUuid;

    if (inputDTO.deliveryZoneUuid !== undefined) {
      const zoneId = await this.zoneDAO.getIdByUuid(
        inputDTO.deliveryZoneUuid,
        getCompanyFilterUuid(req),
      );
      if (!zoneId) {
        res
          .status(400)
          .json({ success: false, message: "Delivery zone not found" });
        return null;
      }
      updateData.deliveryZoneId = zoneId;
    }
    return updateData;
  }
}
