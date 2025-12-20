import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  paginationHelper,
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { CorrugationClassDAO } from "../../dao/corrugation-class/corrugation-class.dao";
import { ICorrugationClass } from "../../interfaces/corrugation-class/corrugation-class.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  CorrugationClassCreateInputDTO,
  CorrugationClassUpdateInputDTO,
} from "../../dto/input/corrugationClass";

export class CorrugationClassController implements IBaseController {
  private _corrugationClassDAO: CorrugationClassDAO = new CorrugationClassDAO();

  /**
   * Get all corrugation classes with pagination
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { page, limit } = paginationHelper(req);

      const result: IDataPaginator<ICorrugationClass> =
        await this._corrugationClassDAO.getAll(page, limit);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get corrugation class by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const result = await this._corrugationClassDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Corrugation class not found",
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
   * Create a new corrugation class
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new CorrugationClassCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: ICorrugationClass = {
        uuid: uuidv4(),
        code: inputDTO.code,
        description: inputDTO.description,
      };

      const result = await this._corrugationClassDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update corrugation class by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // SECURITY: Get internal numeric ID by UUID (never expose ID to frontend)
      const existingId = await this._corrugationClassDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Corrugation class not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new CorrugationClassUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._corrugationClassDAO.update(existingId, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete corrugation class by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // SECURITY: Get internal numeric ID by UUID (never expose ID to frontend)
      const existingId = await this._corrugationClassDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Corrugation class not found",
        });
        return;
      }

      const result = await this._corrugationClassDAO.delete(existingId);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Corrugation class deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete corrugation class",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
