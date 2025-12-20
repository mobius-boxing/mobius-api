import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  paginationHelper,
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { CorrugationDAO } from "../../dao/corrugation/corrugation.dao";
import { CorrugationClassDAO } from "../../dao/corrugation-class/corrugation-class.dao";
import { ICorrugation } from "../../interfaces/corrugation/corrugation.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  CorrugationCreateInputDTO,
  CorrugationUpdateInputDTO,
} from "../../dto/input/corrugation";

export class CorrugationController implements IBaseController {
  private _corrugationDAO: CorrugationDAO = new CorrugationDAO();
  private _corrugationClassDAO: CorrugationClassDAO = new CorrugationClassDAO();

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

      // SECURITY: Lookup corrugation class by UUID to get internal numeric ID
      let corrugationClassId: number | undefined;
      if (inputDTO.corrugationClassUuid) {
        const classId = await this._corrugationClassDAO.getIdByUuid(inputDTO.corrugationClassUuid);
        if (!classId) {
          res.status(400).json({
            success: false,
            message: "Corrugation class not found",
          });
          return;
        }
        corrugationClassId = classId;
      }

      // Generate UUID server-side
      const dataToCreate: ICorrugation = {
        uuid: uuidv4(),
        code: inputDTO.code,
        description: inputDTO.description,
        theoreticalGrammage: inputDTO.theoreticalGrammage,
        suggestedWidth: inputDTO.suggestedWidth,
        caliper: inputDTO.caliper,
        corrugationClassId,
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

      // SECURITY: Get internal numeric ID by UUID (never expose ID to frontend)
      const existingId = await this._corrugationDAO.getIdByUuid(uuid);
      if (!existingId) {
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

      // SECURITY: Lookup corrugation class by UUID if provided
      const updateData: any = { ...inputDTO };
      delete updateData.corrugationClassUuid;

      if (inputDTO.corrugationClassUuid) {
        const corrugationClassId = await this._corrugationClassDAO.getIdByUuid(inputDTO.corrugationClassUuid);
        if (!corrugationClassId) {
          res.status(400).json({
            success: false,
            message: "Corrugation class not found",
          });
          return;
        }
        updateData.corrugationClassId = corrugationClassId;
      }

      const result = await this._corrugationDAO.update(existingId, updateData);

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

      // SECURITY: Get internal numeric ID by UUID (never expose ID to frontend)
      const existingId = await this._corrugationDAO.getIdByUuid(uuid);
      if (!existingId) {
        res.status(404).json({
          success: false,
          message: "Corrugation not found",
        });
        return;
      }

      const result = await this._corrugationDAO.delete(existingId);

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
