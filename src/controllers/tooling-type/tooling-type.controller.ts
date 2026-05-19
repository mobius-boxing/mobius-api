import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { ToolingTypeDAO } from "../../dao/tooling-type/tooling-type.dao";
import { IToolingType } from "../../interfaces/tooling-type/tooling-type.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  ToolingTypeCreateInputDTO,
  ToolingTypeUpdateInputDTO,
} from "../../dto/input/toolingType";
import { enforceCompanyFilter } from "../../utils/companyScope";

export class ToolingTypeController implements IBaseController {
  private _toolingTypeDAO: ToolingTypeDAO = new ToolingTypeDAO();

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      enforceCompanyFilter(req);
      const result: IDataPaginator<IToolingType> =
        await this._toolingTypeDAO.getAllWithFilters(req);
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

      const result = await this._toolingTypeDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Tooling type not found",
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

      const inputDTO = new ToolingTypeCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const dataToCreate: IToolingType = {
        uuid: uuidv4(),
        code: inputDTO.code,
        name: inputDTO.name,
        description: inputDTO.description,
        automaticConsumption: inputDTO.automaticConsumption,
      };

      const result = await this._toolingTypeDAO.create(dataToCreate);

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

      const existingId = await this._toolingTypeDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Tooling type not found",
        });
        return;
      }

      const inputDTO = new ToolingTypeUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._toolingTypeDAO.update(existingId, inputDTO);

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

      const existingId = await this._toolingTypeDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Tooling type not found",
        });
        return;
      }

      const result = await this._toolingTypeDAO.delete(existingId);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Tooling type deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete tooling type",
        });
      }
    } catch (err: any) {
      if (err.code === "23503" || err.message?.includes("foreign key constraint")) {
        res.status(400).json({
          success: false,
          message: "Cannot delete tooling type: it is referenced by toolings. Please remove related data first.",
        });
        return;
      }
      next(err);
    }
  }
}
