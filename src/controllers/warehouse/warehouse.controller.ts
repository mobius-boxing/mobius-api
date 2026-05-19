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

/**
 * Warehouse — CRUD with Co-scope-A (CompanyDAO.getIdByUuid variant), FK-catch
 * on delete, and a bespoke `getWarehouseStock` aggregation endpoint that must
 * remain on this controller.
 *
 * Query params (getAll):
 * - page, limit: Pagination
 * - sortBy, sortOrder: e.g. ?sortBy=name&sortOrder=asc
 * - name, companyId, uuid: Filtering (e.g. ?companyId=5&name=Main)
 * - search: Full-text search across name
 */
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
    // Validation happens in beforeCreate AFTER companyId is injected into body,
    // mirroring the original sequence. Here we just pass req.body through.
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
    // Securely resolve company - JWT for regular users, body for SuperAdmins
    const companyResult = getCompanyForCreate(req);
    if (!companyResult.success) {
      res.status(400).json({
        success: false,
        message: companyResult.message,
      });
      return null;
    }

    // Convert company UUID to numeric ID
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

    // Inject resolved companyId into the data for DTO validation (matches original).
    payload.companyId = companyIdNumeric;

    // Validate input using DTO (kept in beforeCreate because companyId must be
    // present before validation, just like the original).
    const inputDTO = new WarehouseCreateInputDTO(payload).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      // We can't use `next(err)` directly from a hook; throw and let base catch.
      throw new Error(validation.message);
    }

    // Mirror original explicit-field create payload (uuid is added by base class).
    return {
      name: inputDTO.name,
      gridRows: inputDTO.gridRows,
      gridCols: inputDTO.gridCols,
      companyId: companyIdNumeric,
    };
  }

  /**
   * Get all stock (paper and sheet) for a warehouse, grouped by location.
   * GET /warehouse/:uuid/stock
   *
   * Preserved verbatim from pre-migration controller. Inline DAO instantiation
   * (PaperStockDAO/SheetStockDAO/WarehouseLocationDAO) is established behavior —
   * not refactored as part of this migration.
   */
  public async getWarehouseStock(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get warehouse by UUID
      const warehouse = await this.dao.getByUuid(uuid);
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

      // Get all stock for this warehouse
      const [paperStocks, sheetStocks, warehouseLocations] = await Promise.all([
        paperStockDAO.getAllByWarehouseId(warehouse.id),
        sheetStockDAO.getAllByWarehouseId(warehouse.id),
        warehouseLocationDAO.getAllByWarehouseId(warehouse.id),
      ]);

      // Create a map of locationId to stock items
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

      // Map locations for quick lookup
      const locationMap = new Map<number, any>();
      for (const loc of warehouseLocations) {
        locationMap.set(loc.id!, loc);
      }

      // Track unassigned stock
      const unassignedPaperStock: any[] = [];
      const unassignedSheetStock: any[] = [];

      // Group paper stock by location
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

      // Group sheet stock by location
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
