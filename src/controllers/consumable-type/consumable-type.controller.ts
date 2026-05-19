import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { ConsumableTypeDAO } from "../../dao/consumable-type/consumable-type.dao";
import { IConsumableType } from "../../interfaces/consumable-type/consumable-type.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { ConsumableTypeCreateInputDTO } from "../../dto/input/consumable-type/ConsumableTypeCreateInputDTO";
import { ConsumableTypeUpdateInputDTO } from "../../dto/input/consumable-type/ConsumableTypeUpdateInputDTO";
import { v4 as uuidv4 } from "uuid";
import { enforceCompanyFilter } from "../../utils/companyScope";

export class ConsumableTypeController implements IBaseController {
  private _consumableTypeDAO: ConsumableTypeDAO = new ConsumableTypeDAO();

  /**
   * Get all consumable types with filtering, sorting, and search
   *
   * Query params:
   * - page, limit: Pagination
   * - sortBy, sortOrder: Sorting (code, name, createdAt, updatedAt)
   * - code, name, autoConsumption: Filtering
   * - search: Full-text search
   */
  public async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      enforceCompanyFilter(req);
      const result: IDataPaginator<IConsumableType> = await this._consumableTypeDAO.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  public async getByUuid(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { uuid } = req.params;
      const result = await this._consumableTypeDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({ success: false, message: "Consumable type not found" });
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
      const inputDTO = new ConsumableTypeCreateInputDTO(data).build();

      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const dataToCreate: IConsumableType = {
        uuid: uuidv4(),
        code: inputDTO.code,
        name: inputDTO.name,
        autoConsumption: inputDTO.autoConsumption ?? false,
      };

      const result = await this._consumableTypeDAO.create(dataToCreate);

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

      const existingId = await this._consumableTypeDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({ success: false, message: "Consumable type not found" });
        return;
      }

      const inputDTO = new ConsumableTypeUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._consumableTypeDAO.update(existingId, inputDTO);

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

      const existingId = await this._consumableTypeDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({ success: false, message: "Consumable type not found" });
        return;
      }

      const result = await this._consumableTypeDAO.delete(existingId);

      if (result) {
        res.status(200).json({ success: true, message: "Consumable type deleted successfully" });
      } else {
        res.status(404).json({ success: false, message: "Failed to delete consumable type" });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
