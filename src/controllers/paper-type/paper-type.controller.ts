import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  paginationHelper,
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { PaperTypeDAO } from "../../dao/paper-type/paper-type.dao";
import { IPaperType } from "../../interfaces/paper-type/paper-type.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  PaperTypeCreateInputDTO,
  PaperTypeUpdateInputDTO,
} from "../../dto/input/paperType";

export class PaperTypeController implements IBaseController {
  private _paperTypeDAO: PaperTypeDAO = new PaperTypeDAO();

  /**
   * Get all paper types with pagination
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { page, limit } = paginationHelper(req);

      const result: IDataPaginator<IPaperType> =
        await this._paperTypeDAO.getAll(page, limit);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get paper type by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const result = await this._paperTypeDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Paper type not found",
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
   * Create a new paper type
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new PaperTypeCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: IPaperType = {
        uuid: uuidv4(),
        code: inputDTO.code,
        description: inputDTO.description,
      };

      const result = await this._paperTypeDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update paper type by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get paper type by UUID to find its ID
      const existing = await this._paperTypeDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Paper type not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new PaperTypeUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._paperTypeDAO.update(existing.id, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete paper type by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get paper type by UUID to find its ID
      const existing = await this._paperTypeDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Paper type not found",
        });
        return;
      }

      const result = await this._paperTypeDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Paper type deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete paper type",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
