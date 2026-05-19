import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { ToolingDAO } from "../../dao/tooling/tooling.dao";
import { ToolingTypeDAO } from "../../dao/tooling-type/tooling-type.dao";
import { ManufacturerDAO } from "../../dao/manufacturer/manufacturer.dao";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { ITooling } from "../../interfaces/tooling/tooling.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  ToolingCreateInputDTO,
  ToolingUpdateInputDTO,
} from "../../dto/input/tooling";
import { enforceCompanyFilter } from "../../utils/companyScope";

export class ToolingController implements IBaseController {
  private _toolingDAO: ToolingDAO = new ToolingDAO();
  private _toolingTypeDAO: ToolingTypeDAO = new ToolingTypeDAO();
  private _manufacturerDAO: ManufacturerDAO = new ManufacturerDAO();
  private _supplierDAO: SupplierDAO = new SupplierDAO();

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      enforceCompanyFilter(req);
      const result: IDataPaginator<ITooling> =
        await this._toolingDAO.getAllWithFilters(req);
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

      const result = await this._toolingDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Tooling not found",
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

      const inputDTO = new ToolingCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Lookup toolingType by UUID (required)
      const toolingTypeId = await this._toolingTypeDAO.getIdByUuid(inputDTO.toolingTypeUuid);
      if (!toolingTypeId) {
        res.status(400).json({
          success: false,
          message: "Tooling type not found",
        });
        return;
      }

      // Lookup manufacturer by UUID (optional)
      let manufacturerId: number | undefined;
      if (inputDTO.manufacturerUuid) {
        manufacturerId = await this._manufacturerDAO.getIdByUuid(inputDTO.manufacturerUuid) ?? undefined;
        if (!manufacturerId) {
          res.status(400).json({
            success: false,
            message: "Manufacturer not found",
          });
          return;
        }
      }

      // Lookup supplier by UUID (optional)
      let supplierId: number | undefined;
      if (inputDTO.supplierUuid) {
        supplierId = await this._supplierDAO.getIdByUuid(inputDTO.supplierUuid) ?? undefined;
        if (!supplierId) {
          res.status(400).json({
            success: false,
            message: "Supplier not found",
          });
          return;
        }
      }

      const dataToCreate: ITooling = {
        uuid: uuidv4(),
        name: inputDTO.name,
        description: inputDTO.description,
        manufacturerId,
        supplierId,
        minimumStock: inputDTO.minimumStock,
        toolingTypeId,
      };

      const result = await this._toolingDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
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

      const existingId = await this._toolingDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Tooling not found",
        });
        return;
      }

      const inputDTO = new ToolingUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const updateData: Partial<ITooling> = {
        name: inputDTO.name,
        description: inputDTO.description,
        minimumStock: inputDTO.minimumStock,
      };

      // Lookup toolingType by UUID if provided
      if (inputDTO.toolingTypeUuid) {
        const toolingTypeId = await this._toolingTypeDAO.getIdByUuid(inputDTO.toolingTypeUuid);
        if (!toolingTypeId) {
          res.status(400).json({
            success: false,
            message: "Tooling type not found",
          });
          return;
        }
        updateData.toolingTypeId = toolingTypeId;
      }

      // Lookup manufacturer by UUID if provided
      if (inputDTO.manufacturerUuid !== undefined) {
        if (inputDTO.manufacturerUuid === null || inputDTO.manufacturerUuid === "") {
          updateData.manufacturerId = undefined;
        } else {
          const manufacturerId = await this._manufacturerDAO.getIdByUuid(inputDTO.manufacturerUuid);
          if (!manufacturerId) {
            res.status(400).json({
              success: false,
              message: "Manufacturer not found",
            });
            return;
          }
          updateData.manufacturerId = manufacturerId;
        }
      }

      // Lookup supplier by UUID if provided
      if (inputDTO.supplierUuid !== undefined) {
        if (inputDTO.supplierUuid === null || inputDTO.supplierUuid === "") {
          updateData.supplierId = undefined;
        } else {
          const supplierId = await this._supplierDAO.getIdByUuid(inputDTO.supplierUuid);
          if (!supplierId) {
            res.status(400).json({
              success: false,
              message: "Supplier not found",
            });
            return;
          }
          updateData.supplierId = supplierId;
        }
      }

      const result = await this._toolingDAO.update(existingId, updateData);

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

      const existingId = await this._toolingDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Tooling not found",
        });
        return;
      }

      const result = await this._toolingDAO.delete(existingId);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Tooling deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete tooling",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
