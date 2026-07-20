import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ToolingDAO } from "../../dao/tooling/tooling.dao";
import { ToolingTypeDAO } from "../../dao/tooling-type/tooling-type.dao";
import { ManufacturerDAO } from "../../dao/manufacturer/manufacturer.dao";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { ITooling } from "../../interfaces/tooling/tooling.interfaces";
import {
  ToolingCreateInputDTO,
  ToolingUpdateInputDTO,
} from "../../dto/input/tooling";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class ToolingController extends BaseCrudController<ITooling> {
  protected dao = new ToolingDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Tooling",
  };

  private _toolingTypeDAO = new ToolingTypeDAO();
  private _manufacturerDAO = new ManufacturerDAO();
  private _supplierDAO = new SupplierDAO();

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new ToolingCreateInputDTO(req.body).build();
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
    const inputDTO = new ToolingUpdateInputDTO(req.body).build();
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
    const toolingTypeId = await this._toolingTypeDAO.getIdByUuid(
      inputDTO.toolingTypeUuid,
    );
    if (!toolingTypeId) {
      res
        .status(400)
        .json({ success: false, message: "Tooling type not found" });
      return null;
    }

    let manufacturerId: number | undefined;
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

    let supplierId: number | undefined;
    if (inputDTO.supplierUuid) {
      supplierId =
        (await this._supplierDAO.getIdByUuid(inputDTO.supplierUuid)) ??
        undefined;
      if (!supplierId) {
        res.status(400).json({ success: false, message: "Supplier not found" });
        return null;
      }
    }

    return {
      code: inputDTO.code,
      name: inputDTO.name,
      description: inputDTO.description,
      manufacturerId,
      supplierId,
      minimumStock: inputDTO.minimumStock,
      toolingTypeId,
    };
  }

  protected async beforeUpdate(
    inputDTO: any,
    _existingId: number,
    _req: Request,
    res: Response,
  ): Promise<any | null> {
    const updateData: Partial<ITooling> = {
      name: inputDTO.name,
      description: inputDTO.description,
      minimumStock: inputDTO.minimumStock,
    };

    if (inputDTO.toolingTypeUuid) {
      const toolingTypeId = await this._toolingTypeDAO.getIdByUuid(
        inputDTO.toolingTypeUuid,
      );
      if (!toolingTypeId) {
        res
          .status(400)
          .json({ success: false, message: "Tooling type not found" });
        return null;
      }
      updateData.toolingTypeId = toolingTypeId;
    }

    if (inputDTO.manufacturerUuid !== undefined) {
      if (
        inputDTO.manufacturerUuid === null ||
        inputDTO.manufacturerUuid === ""
      ) {
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

    if (inputDTO.supplierUuid !== undefined) {
      if (inputDTO.supplierUuid === null || inputDTO.supplierUuid === "") {
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

    return updateData;
  }
}
