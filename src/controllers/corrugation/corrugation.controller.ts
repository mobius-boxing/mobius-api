import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { CorrugationDAO } from "../../dao/corrugation/corrugation.dao";
import { CorrugationClassDAO } from "../../dao/corrugation-class/corrugation-class.dao";
import { ICorrugation } from "../../interfaces/corrugation/corrugation.interfaces";
import {
  CorrugationCreateInputDTO,
  CorrugationUpdateInputDTO,
} from "../../dto/input/corrugation";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class CorrugationController extends BaseCrudController<ICorrugation> {
  protected dao = new CorrugationDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Corrugation",
  };

  private _corrugationClassDAO = new CorrugationClassDAO();

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new CorrugationCreateInputDTO(req.body).build();
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
    const inputDTO = new CorrugationUpdateInputDTO(req.body).build();
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
    // SECURITY: resolve client-supplied UUID to internal numeric ID before storing.
    let corrugationClassId: number | undefined;
    if (inputDTO.corrugationClassUuid) {
      const classId = await this._corrugationClassDAO.getIdByUuid(
        inputDTO.corrugationClassUuid,
      );
      if (!classId) {
        res.status(400).json({
          success: false,
          message: "Corrugation class not found",
        });
        return null;
      }
      corrugationClassId = classId;
    }

    return {
      code: inputDTO.code,
      description: inputDTO.description,
      theoreticalGrammage: inputDTO.theoreticalGrammage,
      suggestedWidth: inputDTO.suggestedWidth,
      caliper: inputDTO.caliper,
      corrugationClassId,
    };
  }

  protected async beforeUpdate(
    inputDTO: any,
    _existingId: number,
    _req: Request,
    res: Response,
  ): Promise<any | null> {
    const updateData: any = { ...inputDTO };
    delete updateData.corrugationClassUuid;

    if (inputDTO.corrugationClassUuid) {
      const corrugationClassId = await this._corrugationClassDAO.getIdByUuid(
        inputDTO.corrugationClassUuid,
      );
      if (!corrugationClassId) {
        res.status(400).json({
          success: false,
          message: "Corrugation class not found",
        });
        return null;
      }
      updateData.corrugationClassId = corrugationClassId;
    }

    return updateData;
  }
}
