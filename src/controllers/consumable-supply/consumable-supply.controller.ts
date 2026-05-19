import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ConsumableSupplyDAO } from "../../dao/consumable-supply/consumable-supply.dao";
import { SupplierDAO } from "../../dao/supplier/supplier.dao";
import { ManufacturerDAO } from "../../dao/manufacturer/manufacturer.dao";
import { ConsumableTypeDAO } from "../../dao/consumable-type/consumable-type.dao";
import { IConsumableSupply } from "../../interfaces/consumable-supply/consumable-supply.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { ConsumableSupplyCreateInputDTO } from "../../dto/input/consumable-supply/ConsumableSupplyCreateInputDTO";
import { ConsumableSupplyUpdateInputDTO } from "../../dto/input/consumable-supply/ConsumableSupplyUpdateInputDTO";
import { v4 as uuidv4 } from "uuid";
import { enforceCompanyFilter } from "../../utils/companyScope";

export class ConsumableSupplyController implements IBaseController {
  private _consumableSupplyDAO: ConsumableSupplyDAO = new ConsumableSupplyDAO();
  private _supplierDAO: SupplierDAO = new SupplierDAO();
  private _manufacturerDAO: ManufacturerDAO = new ManufacturerDAO();
  private _consumableTypeDAO: ConsumableTypeDAO = new ConsumableTypeDAO();

  /**
   * Get all consumable supplies with filtering, sorting, and search
   *
   * Query params:
   * - page, limit: Pagination
   * - sortBy, sortOrder: Sorting
   * - code, name, supplierId, manufacturerId, consumableTypeId: Filtering
   * - search: Full-text search
   */
  public async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      enforceCompanyFilter(req);
      const result: IDataPaginator<IConsumableSupply> = await this._consumableSupplyDAO.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  public async getByUuid(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { uuid } = req.params;
      const result = await this._consumableSupplyDAO.getWithDetails(uuid);

      if (!result) {
        res.status(404).json({ success: false, message: "Consumable supply not found" });
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

  public async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = req.body;
      const inputDTO = new ConsumableSupplyCreateInputDTO(data).build();

      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Resolve foreign keys from UUIDs
      let supplierId: number | undefined;
      let manufacturerId: number | undefined;
      let consumableTypeId: number | undefined;

      if (inputDTO.supplierUuid) {
        supplierId = await this._supplierDAO.getIdByUuid(inputDTO.supplierUuid) ?? undefined;
        if (!supplierId) {
          res.status(400).json({ success: false, message: "Supplier not found" });
          return;
        }
      }

      if (inputDTO.manufacturerUuid) {
        manufacturerId = await this._manufacturerDAO.getIdByUuid(inputDTO.manufacturerUuid) ?? undefined;
        if (!manufacturerId) {
          res.status(400).json({ success: false, message: "Manufacturer not found" });
          return;
        }
      }

      if (inputDTO.consumableTypeUuid) {
        consumableTypeId = await this._consumableTypeDAO.getIdByUuid(inputDTO.consumableTypeUuid) ?? undefined;
        if (!consumableTypeId) {
          res.status(400).json({ success: false, message: "Consumable type not found" });
          return;
        }
      }

      const dataToCreate: IConsumableSupply = {
        uuid: uuidv4(),
        code: inputDTO.code,
        name: inputDTO.name,
        description: inputDTO.description,
        supplierId,
        manufacturerId,
        consumableTypeId,
      };

      const result = await this._consumableSupplyDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      const existingId = await this._consumableSupplyDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({ success: false, message: "Consumable supply not found" });
        return;
      }

      const inputDTO = new ConsumableSupplyUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Resolve foreign keys from UUIDs
      const updateData: Partial<IConsumableSupply> = {};

      if (inputDTO.code !== undefined) updateData.code = inputDTO.code;
      if (inputDTO.name !== undefined) updateData.name = inputDTO.name;
      if (inputDTO.description !== undefined) updateData.description = inputDTO.description;

      if (inputDTO.supplierUuid !== undefined) {
        if (inputDTO.supplierUuid === "") {
          updateData.supplierId = undefined;
        } else {
          const supplierId = await this._supplierDAO.getIdByUuid(inputDTO.supplierUuid);
          if (!supplierId) {
            res.status(400).json({ success: false, message: "Supplier not found" });
            return;
          }
          updateData.supplierId = supplierId;
        }
      }

      if (inputDTO.manufacturerUuid !== undefined) {
        if (inputDTO.manufacturerUuid === "") {
          updateData.manufacturerId = undefined;
        } else {
          const manufacturerId = await this._manufacturerDAO.getIdByUuid(inputDTO.manufacturerUuid);
          if (!manufacturerId) {
            res.status(400).json({ success: false, message: "Manufacturer not found" });
            return;
          }
          updateData.manufacturerId = manufacturerId;
        }
      }

      if (inputDTO.consumableTypeUuid !== undefined) {
        if (inputDTO.consumableTypeUuid === "") {
          updateData.consumableTypeId = undefined;
        } else {
          const consumableTypeId = await this._consumableTypeDAO.getIdByUuid(inputDTO.consumableTypeUuid);
          if (!consumableTypeId) {
            res.status(400).json({ success: false, message: "Consumable type not found" });
            return;
          }
          updateData.consumableTypeId = consumableTypeId;
        }
      }

      const result = await this._consumableSupplyDAO.update(existingId, updateData);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { uuid } = req.params;

      const existingId = await this._consumableSupplyDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({ success: false, message: "Consumable supply not found" });
        return;
      }

      const result = await this._consumableSupplyDAO.delete(existingId);

      if (result) {
        res.status(200).json({ success: true, message: "Consumable supply deleted successfully" });
      } else {
        res.status(404).json({ success: false, message: "Failed to delete consumable supply" });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
