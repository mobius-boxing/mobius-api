import { Request, Response, NextFunction } from "express";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { WarehouseDAO } from "../../dao/warehouse/warehouse.dao";
import { CompanyDAO } from "../../dao/company/company.dao";
import { PaperStockDAO } from "../../dao/paper-stock/paper-stock.dao";
import { SheetStockDAO } from "../../dao/sheet-stock/sheet-stock.dao";
import { ConsumableStockDAO } from "../../dao/consumable-stock/consumable-stock.dao";
import { ToolingStockDAO } from "../../dao/tooling-stock/tooling-stock.dao";
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
    _next: NextFunction,
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
   * GET /warehouse/:uuid/stock — every physical stock type (paper, sheet,
   * consumable, tooling) grouped by the location it sits in. A cell can hold
   * any mix of the four; items with no location come back in the unassigned
   * lists. Catalogue entities (supplies, sheet/tooling definitions) are not
   * stock on hand, so they never occupy a cell.
   */
  public async getWarehouseStock(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // SECURITY (C2): scope the warehouse lookup to the caller's company; cross-company → 404.
      const companyScope = this.itemCompanyScope(req);
      const warehouse = await this.dao.getByUuid(uuid, companyScope);
      if (!warehouse || !warehouse.id) {
        res.status(404).json({
          success: false,
          message: "Warehouse not found",
        });
        return;
      }

      const paperStockDAO = new PaperStockDAO();
      const sheetStockDAO = new SheetStockDAO();
      const consumableStockDAO = new ConsumableStockDAO();
      const toolingStockDAO = new ToolingStockDAO();
      const warehouseLocationDAO = new WarehouseLocationDAO();

      const [
        paperStocks,
        sheetStocks,
        consumableStocks,
        toolingStocks,
        warehouseLocations,
      ] = await Promise.all([
        paperStockDAO.getAllByWarehouseId(warehouse.id),
        sheetStockDAO.getAllByWarehouseId(warehouse.id),
        consumableStockDAO.getAllByWarehouseId(warehouse.id),
        toolingStockDAO.getAllByWarehouseId(warehouse.id),
        warehouseLocationDAO.getAllByWarehouseId(warehouse.id),
      ]);

      type StockField =
        | "paperStock"
        | "sheetStock"
        | "consumableStock"
        | "toolingStock";

      interface LocationBucket {
        locationId: number;
        locationUuid: string;
        locationCode: string;
        row: number;
        col: number;
        locationType: string;
        paperStock: any[];
        sheetStock: any[];
        consumableStock: any[];
        toolingStock: any[];
        totalItems: number;
      }

      const locationMap = new Map<number, any>();
      for (const loc of warehouseLocations) {
        locationMap.set(loc.id!, loc);
      }

      const stockByLocation: Record<string, LocationBucket> = {};
      const unassigned: Record<StockField, any[]> = {
        paperStock: [],
        sheetStock: [],
        consumableStock: [],
        toolingStock: [],
      };

      // Drop each stock item into its location's bucket, or into the unassigned
      // list when it has no location or points at a location that no longer
      // exists (e.g. cleared by a grid resize).
      const assign = (
        items: Array<{ warehouseLocationId?: number }>,
        field: StockField,
      ): void => {
        for (const item of items) {
          const loc = item.warehouseLocationId
            ? locationMap.get(item.warehouseLocationId)
            : undefined;
          if (!loc) {
            unassigned[field].push(item);
            continue;
          }
          const key = String(loc.id);
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
              consumableStock: [],
              toolingStock: [],
              totalItems: 0,
            };
          }
          stockByLocation[key][field].push(item);
          stockByLocation[key].totalItems++;
        }
      };

      assign(paperStocks, "paperStock");
      assign(sheetStocks, "sheetStock");
      assign(consumableStocks, "consumableStock");
      assign(toolingStocks, "toolingStock");

      res.status(200).json({
        success: true,
        data: {
          warehouse: warehouse,
          locations: Object.values(stockByLocation),
          unassignedPaperStock: unassigned.paperStock,
          unassignedSheetStock: unassigned.sheetStock,
          unassignedConsumableStock: unassigned.consumableStock,
          unassignedToolingStock: unassigned.toolingStock,
          totalPaperStock: paperStocks.length,
          totalSheetStock: sheetStocks.length,
          totalConsumableStock: consumableStocks.length,
          totalToolingStock: toolingStocks.length,
        },
      });
    } catch (err: any) {
      next(err);
    }
  }
}
