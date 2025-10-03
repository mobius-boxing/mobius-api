import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { paginationHelper, inputValidator, IInputValidator } from "@sundaysf/utils";
import { CustomerDAO } from "../../dao/customer/customer.dao";
import { ICustomer } from "../../interfaces/customer/customer.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import { CustomerCreateInputDTO, CustomerUpdateInputDTO } from "../../dto/input/customer";

export class CustomerController implements IBaseController {
  private _customerDAO: CustomerDAO = new CustomerDAO();

  /**
   * Get all customers with pagination
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { page, limit } = paginationHelper(req);
      const result: IDataPaginator<ICustomer> = await this._customerDAO.getAll(
        page,
        limit
      );
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get customer by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const result = await this._customerDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Customer not found",
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
   * Create a new customer
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new CustomerCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const dataToCreate: ICustomer = {
        uuid: uuidv4(),
        companyId: inputDTO.companyId,
        customerUuid: uuidv4(),
        name: inputDTO.name,
        supplierCode: inputDTO.supplierCode,
        salesPersonId: inputDTO.salesPersonId,
        categoryId: inputDTO.categoryId,
        active: true,
        legalName: inputDTO.legalName,
        address: inputDTO.address,
        tradeName: inputDTO.tradeName,
        contacts: inputDTO.contacts || [],
        deliveryLocations: inputDTO.deliveryLocations || [],
        deliveryDays: inputDTO.deliveryDays || [],
      };

      const result = await this._customerDAO.create(dataToCreate);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update customer by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get customer by UUID to find its ID
      const existing = await this._customerDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Customer not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new CustomerUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      const result = await this._customerDAO.update(existing.id, inputDTO);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete customer by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get customer by UUID to find its ID
      const existing = await this._customerDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "Customer not found",
        });
        return;
      }

      const result = await this._customerDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "Customer deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete customer",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get customer with related details (company, category, sales person)
   */
  public async getWithDetails(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const result = await this._customerDAO.getCustomerWithDetails(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Customer not found",
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
}
