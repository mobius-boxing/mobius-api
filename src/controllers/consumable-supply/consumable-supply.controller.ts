import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ConsumableSupplyDAO } from "../../dao/consumable-supply/consumable-supply.dao";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { ManufacturerDAO } from "../../dao/manufacturer/manufacturer.dao";
import { ConsumableTypeDAO } from "../../dao/consumable-type/consumable-type.dao";
import { IConsumableSupply } from "../../interfaces/consumable-supply/consumable-supply.interfaces";
import { ConsumableSupplyCreateInputDTO } from "../../dto/input/consumable-supply/ConsumableSupplyCreateInputDTO";
import { ConsumableSupplyUpdateInputDTO } from "../../dto/input/consumable-supply/ConsumableSupplyUpdateInputDTO";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class ConsumableSupplyController extends BaseCrudController<IConsumableSupply> {
  protected dao = new ConsumableSupplyDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Consumable supply",
  };

  private _supplierDAO = new SupplierDAO();
  private _manufacturerDAO = new ManufacturerDAO();
  private _consumableTypeDAO = new ConsumableTypeDAO();

  protected async getOneByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IConsumableSupply | null> {
    // SECURITY (C2): ownership gate via the company-scoped getByUuid before returning details.
    if (companyUuid && !(await this.dao.getByUuid(uuid, companyUuid))) {
      return null;
    }
    return this.dao.getWithDetails(uuid);
  }

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new ConsumableSupplyCreateInputDTO(req.body).build();
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
    const inputDTO = new ConsumableSupplyUpdateInputDTO(req.body).build();
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
    _req: Request,
    res: Response,
  ): Promise<any | null> {
    let supplierId: number | undefined;
    let manufacturerId: number | undefined;
    let consumableTypeId: number | undefined;

    if (inputDTO.supplierUuid) {
      supplierId =
        (await this._supplierDAO.getIdByUuid(inputDTO.supplierUuid)) ??
        undefined;
      if (!supplierId) {
        res.status(400).json({ success: false, message: "Supplier not found" });
        return null;
      }
    }

    if (inputDTO.manufacturerUuid) {
      manufacturerId =
        (await this._manufacturerDAO.getIdByUuid(inputDTO.manufacturerUuid)) ??
        undefined;
      if (!manufacturerId) {
        res
          .status(400)
          .json({ success: false, message: "Manufacturer not found" });
        return null;
      }
    }

    if (inputDTO.consumableTypeUuid) {
      consumableTypeId =
        (await this._consumableTypeDAO.getIdByUuid(
          inputDTO.consumableTypeUuid,
        )) ?? undefined;
      if (!consumableTypeId) {
        res
          .status(400)
          .json({ success: false, message: "Consumable type not found" });
        return null;
      }
    }

    // SECURITY: resolve client-supplied color UUID to internal numeric ID.
    let colorId: number | undefined;
    if (inputDTO.colorUuid) {
      const { ColorDAO } = await import("../../dao/color/color.dao");
      colorId = (await new ColorDAO().getIdByUuid(inputDTO.colorUuid)) ?? undefined;
      if (!colorId) {
        res.status(400).json({ success: false, message: "Color not found" });
        return null;
      }
    }

    return {
      code: inputDTO.code,
      name: inputDTO.name,
      description: inputDTO.description,
      supplierId,
      manufacturerId,
      consumableTypeId,
      location: inputDTO.location,
      expiry: inputDTO.expiry,
      minimumStock: inputDTO.minimumStock,
      colorId,
    };
  }

  protected async beforeUpdate(
    inputDTO: any,
    _existingId: number,
    _req: Request,
    res: Response,
  ): Promise<any | null> {
    const updateData: Partial<IConsumableSupply> = {};

    if (inputDTO.code !== undefined) updateData.code = inputDTO.code;
    if (inputDTO.name !== undefined) updateData.name = inputDTO.name;
    if (inputDTO.description !== undefined)
      updateData.description = inputDTO.description;

    if (inputDTO.supplierUuid !== undefined) {
      if (inputDTO.supplierUuid === "") {
        updateData.supplierId = undefined;
      } else {
        const supplierId = await this._supplierDAO.getIdByUuid(
          inputDTO.supplierUuid,
        );
        if (!supplierId) {
          res
            .status(400)
            .json({ success: false, message: "Supplier not found" });
          return null;
        }
        updateData.supplierId = supplierId;
      }
    }

    if (inputDTO.manufacturerUuid !== undefined) {
      if (inputDTO.manufacturerUuid === "") {
        updateData.manufacturerId = undefined;
      } else {
        const manufacturerId = await this._manufacturerDAO.getIdByUuid(
          inputDTO.manufacturerUuid,
        );
        if (!manufacturerId) {
          res
            .status(400)
            .json({ success: false, message: "Manufacturer not found" });
          return null;
        }
        updateData.manufacturerId = manufacturerId;
      }
    }

    if (inputDTO.consumableTypeUuid !== undefined) {
      if (inputDTO.consumableTypeUuid === "") {
        updateData.consumableTypeId = undefined;
      } else {
        const consumableTypeId = await this._consumableTypeDAO.getIdByUuid(
          inputDTO.consumableTypeUuid,
        );
        if (!consumableTypeId) {
          res
            .status(400)
            .json({ success: false, message: "Consumable type not found" });
          return null;
        }
        updateData.consumableTypeId = consumableTypeId;
      }
    }

    if (inputDTO.location !== undefined) updateData.location = inputDTO.location;
    if (inputDTO.expiry !== undefined) updateData.expiry = inputDTO.expiry;
    if (inputDTO.minimumStock !== undefined)
      updateData.minimumStock = inputDTO.minimumStock;

    if (inputDTO.colorUuid !== undefined) {
      if (inputDTO.colorUuid === "" || inputDTO.colorUuid === null) {
        updateData.colorId = null;
      } else {
        const { ColorDAO } = await import("../../dao/color/color.dao");
        const colorId = await new ColorDAO().getIdByUuid(inputDTO.colorUuid);
        if (!colorId) {
          res.status(400).json({ success: false, message: "Color not found" });
          return null;
        }
        updateData.colorId = colorId;
      }
    }

    return updateData;
  }
}
