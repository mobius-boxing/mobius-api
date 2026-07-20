import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { WarehouseDAO } from "../../dao/warehouse/warehouse.dao";
import { CompanyDAO } from "../../dao/company/company.dao";
import { PaperStockDAO } from "../../dao/paper-stock/paper-stock.dao";
import { SheetStockDAO } from "../../dao/sheet-stock/sheet-stock.dao";
import { WarehouseLocationDAO } from "../../dao/warehouseLocation/warehouseLocation.dao";
import { IWarehouse } from "../../interfaces/warehouse/warehouse.interfaces";
import {
  WarehouseCreateInputDTO,
  WarehouseUpdateInputDTO,
} from "../../dto/input/warehouse";
import { getCompanyForCreate } from "../../utils/companyScope";
import {
  BaseCrudController,
  BaseCrudOptions,
} from "../base/base-crud.controller";

export class WarehouseController extends BaseCrudController<IWarehouse> {
  protected dao = new WarehouseDAO();
  protected options: BaseCrudOptions = {
    entityLabel: "Warehouse",
    fkCatchOnDelete: true,
  };

  protected async buildCreateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    // Validation runs in beforeCreate so it sees the injected companyId.
    return req.body;
  }

  protected async buildUpdateDTO(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<any | null> {
    const inputDTO = new WarehouseUpdateInputDTO(req.body).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      next(new Error(validation.message));
      return null;
    }
    return inputDTO;
  }

  protected async beforeCreate(
    payload: any,
    req: Request,
    res: Response,
  ): Promise<any | null> {
    // SECURITY: regular users' companyId comes from JWT; only SuperAdmins may override via body.
    const companyResult = getCompanyForCreate(req);
    if (!companyResult.success) {
      res.status(400).json({
        success: false,
        message: companyResult.message,
      });
      return null;
    }

    const companyDAO = new CompanyDAO();
    const companyIdNumeric = await companyDAO.getIdByUuid(
      companyResult.companyUuid,
    );
    if (!companyIdNumeric) {
      res.status(400).json({
        success: false,
        message: "Invalid company",
      });
      return null;
    }

    payload.companyId = companyIdNumeric;

    const inputDTO = new WarehouseCreateInputDTO(payload).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      // Hooks can't call next() directly; throw so the base catch forwards it.
      throw new Error(validation.message);
    }

    return {
      name: inputDTO.name,
      gridRows: inputDTO.gridRows,
      gridCols: inputDTO.gridCols,
      companyId: companyIdNumeric,
    };
  }

  /**
   * GET /warehouse/:uuid/stock — paper + sheet stock grouped by location.
   */
  public async getWarehouseStock(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // SECURITY (C2): scope the warehouse lookup to the caller's company; cross-company → 404.
      const companyUuid = this.itemCompanyUuid(req);
      const warehouse = await this.dao.getByUuid(uuid, companyUuid);
      if (!warehouse || !warehouse.id) {
        res.status(404).json({
          success: false,
          message: "Warehouse not found",
        });
        return;
      }

      const paperStockDAO = new PaperStockDAO();
      const sheetStockDAO = new SheetStockDAO();
      const warehouseLocationDAO = new WarehouseLocationDAO();

      const [paperStocks, sheetStocks, warehouseLocations] = await Promise.all([
        paperStockDAO.getAllByWarehouseId(warehouse.id),
        sheetStockDAO.getAllByWarehouseId(warehouse.id),
        warehouseLocationDAO.getAllByWarehouseId(warehouse.id),
      ]);

      const stockByLocation: Record<
        string,
        {
          locationId: number;
          locationUuid: string;
          locationCode: string;
          row: number;
          col: number;
          locationType: string;
          paperStock: any[];
          sheetStock: any[];
          totalItems: number;
        }
      > = {};

      const locationMap = new Map<number, any>();
      for (const loc of warehouseLocations) {
        locationMap.set(loc.id!, loc);
      }

      const unassignedPaperStock: any[] = [];
      const unassignedSheetStock: any[] = [];

      for (const ps of paperStocks) {
        if (ps.warehouseLocationId) {
          const loc = locationMap.get(ps.warehouseLocationId);
          if (loc) {
            const key = String(ps.warehouseLocationId);
            if (!stockByLocation[key]) {
              stockByLocation[key] = {
                locationId: loc.id,
                locationUuid: loc.uuid,
                locationCode: loc.locationCode,
                row: loc.row,
                col: loc.col,
                locationType: loc.locationType || "storage",
                paperStock: [],
                sheetStock: [],
                totalItems: 0,
              };
            }
            stockByLocation[key].paperStock.push(ps);
            stockByLocation[key].totalItems++;
          } else {
            unassignedPaperStock.push(ps);
          }
        } else {
          unassignedPaperStock.push(ps);
        }
      }

      for (const ss of sheetStocks) {
        if (ss.warehouseLocationId) {
          const loc = locationMap.get(ss.warehouseLocationId);
          if (loc) {
            const key = String(ss.warehouseLocationId);
            if (!stockByLocation[key]) {
              stockByLocation[key] = {
                locationId: loc.id,
                locationUuid: loc.uuid,
                locationCode: loc.locationCode,
                row: loc.row,
                col: loc.col,
                locationType: loc.locationType || "storage",
                paperStock: [],
                sheetStock: [],
                totalItems: 0,
              };
            }
            stockByLocation[key].sheetStock.push(ss);
            stockByLocation[key].totalItems++;
          } else {
            unassignedSheetStock.push(ss);
          }
        } else {
          unassignedSheetStock.push(ss);
        }
      }

      res.status(200).json({
        success: true,
        data: {
          warehouse: warehouse,
          locations: Object.values(stockByLocation),
          unassignedPaperStock,
          unassignedSheetStock,
          totalPaperStock: paperStocks.length,
          totalSheetStock: sheetStocks.length,
        },
      });
    } catch (err: any) {
      next(err);
    }
  }
}
