import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import {
  paginationHelper,
  inputValidator,
  IInputValidator,
} from "@sundaysf/utils";
import { WarehouseDAO } from "../../dao/warehouse/warehouse.dao";
import { CompanyDAO } from "../../dao/company/company.dao";
import { PaperStockDAO } from "../../dao/paper-stock/paper-stock.dao";
import { SheetStockDAO } from "../../dao/sheet-stock/sheet-stock.dao";
import { WarehouseLocationDAO } from "../../dao/warehouseLocation/warehouseLocation.dao";
import { IWarehouse } from "../../interfaces/warehouse/warehouse.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  WarehouseCreateInputDTO,
  WarehouseUpdateInputDTO,
} from "../../dto/input/warehouse";
import { getCompanyForCreate, enforceCompanyFilter } from "../../utils/companyScope";

export class WarehouseController implements IBaseController {
  private _warehouseDAO: WarehouseDAO = new WarehouseDAO();

  /**
   * Get all warehouses with pagination, filtering, sorting, and search
   *
   * Query params (flat syntax):
   * - page, limit: Pagination (e.g., ?page=1&limit=20)
   * - sortBy, sortOrder: Sorting (e.g., ?sortBy=name&sortOrder=asc)
   * - name, companyId, uuid: Filtering (e.g., ?companyId=5&name=Main)
   * - search: Full-text search across name (e.g., ?search=warehouse)
   *
   * Examples:
   * - GET /warehouses?page=1&limit=10
   * - GET /warehouses?sortBy=createdAt&sortOrder=desc
   * - GET /warehouses?companyId=3&name=Main
   * - GET /warehouses?search=central
   * - GET /warehouses?page=1&companyId=3&sortBy=name&sortOrder=asc
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      enforceCompanyFilter(req);
      const result: IDataPaginator<IWarehouse> =
        await this._warehouseDAO.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get warehouse by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const result = await this._warehouseDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Warehouse not found",
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
   * Create a new warehouse
   * Company is determined securely:
   * - SuperAdmins: must provide companyId in request body
   * - Regular users: company extracted from JWT (body companyId ignored)
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;

      // Securely resolve company - JWT for regular users, body for SuperAdmins
      const companyResult = getCompanyForCreate(req);
      if (!companyResult.success) {
        res.status(400).json({
          success: false,
          message: companyResult.message,
        });
        return;
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
        return;
      }

      // Inject the resolved companyId into data for DTO validation
      data.companyId = companyIdNumeric;

      // Validate input using DTO
      const inputDTO = new WarehouseCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Generate UUID server-side
      const dataToCreate: IWarehouse = {
        uuid: uuidv4(),
        name: inputDTO.name,
        gridRows: inputDTO.gridRows,
        gridCols: inputDTO.gridCols,
        companyId: companyIdNumeric,
      };

      const result = await this._warehouseDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update warehouse by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get warehouse by UUID to find its ID
      const existing = await this._warehouseDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Warehouse not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new WarehouseUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._warehouseDAO.update(existing.id, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete warehouse by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get warehouse by UUID to find its ID
      const existing = await this._warehouseDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Warehouse not found",
        });
        return;
      }

      const result = await this._warehouseDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Warehouse deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete warehouse",
        });
      }
    } catch (err: any) {
      // Handle foreign key constraint errors
      if (
        err.code === "23503" ||
        err.message?.includes("foreign key constraint")
      ) {
        res.status(400).json({
          success: false,
          message:
            "Cannot delete warehouse: it is referenced by other records. Please remove related data first.",
        });
        return;
      }
      next(err);
    }
  }

  /**
   * Get all stock (paper and sheet) for a warehouse, grouped by location
   * GET /warehouse/:uuid/stock
   */
  public async getWarehouseStock(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get warehouse by UUID
      const warehouse = await this._warehouseDAO.getByUuid(uuid);
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
