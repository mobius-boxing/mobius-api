import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  paginationHelper,
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { CorrugationDAO } from "../../dao/corrugation/corrugation.dao";
import { ICorrugation } from "../../interfaces/corrugation/corrugation.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  CorrugationCreateInputDTO,
  CorrugationUpdateInputDTO,
} from "../../dto/input/corrugation";

export class CorrugationController implements IBaseController {
  private _corrugationDAO: CorrugationDAO = new CorrugationDAO();

  /**
   * Get all corrugations with pagination
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { page, limit } = paginationHelper(req);

      const result: IDataPaginator<ICorrugation> =
        await this._corrugationDAO.getAll(page, limit);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get corrugation by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const result = await this._corrugationDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Corrugation not found",
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
   * Create a new corrugation
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new CorrugationCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: ICorrugation = {
        uuid: uuidv4(),
        code: inputDTO.code,
        description: inputDTO.description,
        theoreticalGrammage: inputDTO.theoreticalGrammage,
        suggestedWidth: inputDTO.suggestedWidth,
        caliper: inputDTO.caliper,
        corrugationClassId: inputDTO.corrugationClassId,
      };

      const result = await this._corrugationDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update corrugation by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get corrugation by UUID to find its ID
      const existing = await this._corrugationDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Corrugation not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new CorrugationUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._corrugationDAO.update(existing.id, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete corrugation by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get corrugation by UUID to find its ID
      const existing = await this._corrugationDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Corrugation not found",
        });
        return;
      }

      const result = await this._corrugationDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Corrugation deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete corrugation",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
