import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { inputValidator, IInputValidator } from "@sundaysf/utils";
import { CustomerCategoryDAO } from "../../dao/customer-category/customer-category.dao";
import { CompanyDAO } from "../../dao/company/company.dao";
import { ICustomerCategory } from "../../interfaces/customer-category/customer-category.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import {
  CustomerCategoryCreateInputDTO,
  CustomerCategoryUpdateInputDTO,
} from "../../dto/input/customerCategory";
import { getCompanyFilterUuid } from "../../utils/companyScope";

export class CustomerCategoryController implements IBaseController {
  private _customerCategoryDAO: CustomerCategoryDAO = new CustomerCategoryDAO();

  /**
   * SuperAdmin: filters by companyId from query params.
   * Regular users: always filtered by their assigned company (enforced server-side).
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result: IDataPaginator<ICustomerCategory> =
        await this._customerCategoryDAO.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const companyId = getCompanyFilterUuid(req);

      const result = await this._customerCategoryDAO.getByUuid(uuid, companyId);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Customer category not found",
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

  public async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const data = req.body;
      const user = (req as any).user;

      let companyIdNumeric: number;

      if (user.role === "superAdmin") {
        if (!data.companyId) {
          res.status(400).json({
            success: false,
            message: "SuperAdmin must specify a company",
          });
          return;
        }
        const companyDAO = new CompanyDAO();
        const numericId =
          typeof data.companyId === "string"
            ? await companyDAO.getIdByUuid(data.companyId)
            : data.companyId;
        if (!numericId) {
          res.status(400).json({
            success: false,
            message: "Invalid company",
          });
          return;
        }
        companyIdNumeric = numericId;
      } else {
        // SECURITY: regular users' companyId is taken from JWT, never from the request body.
        if (!user.companyId) {
          res.status(400).json({
            success: false,
            message:
              "User must belong to a company to create customer categories",
          });
          return;
        }
        const companyDAO = new CompanyDAO();
        const numericId = await companyDAO.getIdByUuid(user.companyId);
        if (!numericId) {
          res.status(400).json({
            success: false,
            message: "Invalid company",
          });
          return;
        }
        companyIdNumeric = numericId;
      }

      data.companyId = companyIdNumeric;

      const inputDTO = new CustomerCategoryCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // SECURITY: uuid is generated server-side; never trust client-supplied uuids.
      const dataToCreate: ICustomerCategory = {
        uuid: uuidv4(),
        name: inputDTO.name,
        companyId: inputDTO.companyId,
      };

      const result = await this._customerCategoryDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      const companyId = getCompanyFilterUuid(req);

      // companyId filter doubles as ownership check (404 if not in user's company).
      const existing = await this._customerCategoryDAO.getByUuid(
        uuid,
        companyId,
      );
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Customer category not found",
        });
        return;
      }

      const inputDTO = new CustomerCategoryUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._customerCategoryDAO.update(
        existing.id,
        inputDTO,
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      const companyId = getCompanyFilterUuid(req);

      // companyId filter doubles as ownership check (404 if not in user's company).
      const existing = await this._customerCategoryDAO.getByUuid(
        uuid,
        companyId,
      );
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Customer category not found",
        });
        return;
      }

      const result = await this._customerCategoryDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Customer category deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete customer category",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }
}
