import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { WarehouseLocationDAO } from "../../dao/warehouseLocation/warehouseLocation.dao";
import { WarehouseDAO } from "../../dao/warehouse/warehouse.dao";
import { IWarehouseLocation } from "../../interfaces/warehouseLocation/warehouseLocation.interfaces";
import {
  WarehouseLocationCreateInputDTO,
  WarehouseLocationUpdateInputDTO,
  WarehouseLocationBatchUpdateInputDTO,
} from "../../dto/input/warehouseLocation";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";
import { getCompanyFilterUuid } from "../../utils/companyScope";

export class WarehouseLocationController extends BaseCrudController<IWarehouseLocation> {
  protected dao = new WarehouseLocationDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Warehouse location",
  };

  private _warehouseDAO = new WarehouseDAO();

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new WarehouseLocationCreateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return {
      warehouseId: inputDTO.warehouseId,
      row: inputDTO.row,
      col: inputDTO.col,
      status: inputDTO.status,
      locationType: inputDTO.locationType,
      locationCode: inputDTO.locationCode,
      capacity: inputDTO.capacity,
      metadata: inputDTO.metadata,
    };
  }

  protected async buildUpdateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new WarehouseLocationUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }

  public async getByWarehouse(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { warehouseUuid } = req.params;

      // SECURITY (C2): scope the warehouse to the caller's company so cross-company warehouse
      // uuids resolve to "not found" (closes a read IDOR on getByWarehouse and a write IDOR on batchUpdate).
      const warehouseId = await this._warehouseDAO.getIdByUuid(
        warehouseUuid,
        getCompanyFilterUuid(req),
      );
      if (!warehouseId) {
        res.status(404).json({
          success: false,
          message: "Warehouse not found",
        });
        return;
      }

      const result = await this.dao.getAllByWarehouseId(warehouseId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async batchUpdate(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { warehouseUuid } = req.params;
      const data = req.body;

      // SECURITY (C2): scope the warehouse to the caller's company so cross-company warehouse
      // uuids resolve to "not found" (closes a read IDOR on getByWarehouse and a write IDOR on batchUpdate).
      const warehouseId = await this._warehouseDAO.getIdByUuid(
        warehouseUuid,
        getCompanyFilterUuid(req),
      );
      if (!warehouseId) {
        res.status(404).json({
          success: false,
          message: "Warehouse not found",
        });
        return;
      }

      const inputDTO = new WarehouseLocationBatchUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this.dao.batchUpdate(
        warehouseId,
        inputDTO.locations,
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }
}
