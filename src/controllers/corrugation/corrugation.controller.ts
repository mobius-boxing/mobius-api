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
import { getIdByUuid } from "../../utils/foreignKeyResolver";
import { ICorrugationLayer } from "../../interfaces/corrugation/corrugation.interfaces";

export class CorrugationController extends BaseCrudController<ICorrugation> {
  protected dao = new CorrugationDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Corrugation",
  };

  private _corrugationClassDAO = new CorrugationClassDAO();

  /**
   * Resolve a Capas payload: sort by the client-given position, then resolve
   * each layer's lookup UUIDs to internal ids. Returns null (after writing the
   * 400) when a referenced lookup doesn't exist. Positions are renumbered 1..N
   * by the DAO from array order — Procusto grid semantics.
   */
  private async resolveLayers(
    layers:
      | Array<{
          position?: number;
          isLiner?: boolean;
          paperClassUuid?: string;
          fluteTypeUuid?: string;
        }>
      | undefined,
    res: Response,
  ): Promise<ICorrugationLayer[] | null | undefined> {
    if (layers === undefined) return undefined;

    const ordered = [...layers].sort(
      (a, b) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) -
        (b.position ?? Number.MAX_SAFE_INTEGER),
    );

    const resolved: ICorrugationLayer[] = [];
    for (const [index, layer] of ordered.entries()) {
      const paperClassId = layer.paperClassUuid
        ? await getIdByUuid(layer.paperClassUuid, "paper_classes")
        : null;
      if (layer.paperClassUuid && !paperClassId) {
        res.status(400).json({
          success: false,
          message: `Layer ${index + 1}: paper class not found`,
        });
        return null;
      }
      const fluteTypeId = layer.fluteTypeUuid
        ? await getIdByUuid(layer.fluteTypeUuid, "flute_types")
        : null;
      if (layer.fluteTypeUuid && !fluteTypeId) {
        res.status(400).json({
          success: false,
          message: `Layer ${index + 1}: flute type not found`,
        });
        return null;
      }
      resolved.push({
        position: index + 1,
        isLiner: layer.isLiner ?? false,
        paperClassId,
        fluteTypeId,
      });
    }
    return resolved;
  }

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

    const layers = await this.resolveLayers(inputDTO.layers, res);
    if (layers === null) return null;

    return {
      code: inputDTO.code,
      description: inputDTO.description,
      theoreticalGrammage: inputDTO.theoreticalGrammage,
      suggestedWidth: inputDTO.suggestedWidth,
      caliper: inputDTO.caliper,
      corrugationClassId,
      ...(layers !== undefined ? { layers } : {}),
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
    delete updateData.layers;

    const layers = await this.resolveLayers(inputDTO.layers, res);
    if (layers === null) return null;
    if (layers !== undefined) updateData.layers = layers;

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
