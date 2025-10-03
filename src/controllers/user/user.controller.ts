import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types.d";
import { paginationHelper, inputValidator, IInputValidator } from "@sundaysf/utils";
import { UserDAO } from "../../dao/user/user.dao";
import { IUser } from "../../interfaces/user/user.interfaces";
import { IDataPaginator } from "../../database/d.types";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { UserCreateInputDTO, UserUpdateInputDTO } from "../../dto/input/user";

export class UserController implements IBaseController {
  private _userDAO: UserDAO = new UserDAO();

  /**
   * Get all users with pagination
   */
  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { page, limit } = paginationHelper(req);
      const result: IDataPaginator<IUser> = await this._userDAO.getAll(
        page,
        limit
      );

      // Remove passwords from all users
      result.data = result.data.map((user) => {
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword as IUser;
      });

      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get user by UUID
   */
  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const result = await this._userDAO.getByUuid(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      // Remove password from response
      const { password, ...userWithoutPassword } = result;

      res.status(200).json({
        success: true,
        data: userWithoutPassword,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Create a new user
   */
  public async create(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const data = req.body;

      // Validate input using DTO
      const inputDTO = new UserCreateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Check if user already exists
      const existingUser = await this._userDAO.getUserByEmail(inputDTO.email);
      if (existingUser) {
        res.status(400).json({
          success: false,
          message: "User with this email already exists",
        });
        return;
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(inputDTO.password, 10);

      const dataToCreate: IUser = {
        uuid: uuidv4(),
        email: inputDTO.email,
        password: hashedPassword,
        firstName: inputDTO.firstName,
        lastName: inputDTO.lastName,
        role: inputDTO.role,
        companyId: inputDTO.companyId,
        isActive: true,
        emailVerified: false,
      };

      const result = await this._userDAO.create(dataToCreate);

      // Remove password from response
      const { password, ...userWithoutPassword } = result;

      res.status(201).json({
        success: true,
        data: userWithoutPassword,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Update user by UUID
   */
  public async update(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const data = req.body;

      // Get user by UUID to find its ID
      const existing = await this._userDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      // Validate input using DTO
      const inputDTO = new UserUpdateInputDTO(data).build();
      const validation: IInputValidator = await inputValidator(inputDTO);
      if (!validation.success) {
        req.statusCode = 400;
        return next(new Error(validation.message));
      }

      // Hash password if being updated
      const updateData: any = { ...inputDTO };
      if (inputDTO.password !== undefined) {
        updateData.password = await bcrypt.hash(inputDTO.password, 10);
      }

      const result = await this._userDAO.update(existing.id, updateData);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Failed to update user",
        });
        return;
      }

      // Remove password from response
      const { password, ...userWithoutPassword } = result;

      res.status(200).json({
        success: true,
        data: userWithoutPassword,
      });
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Delete user by UUID
   */
  public async delete(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { uuid } = req.params;

      // Get user by UUID to find its ID
      const existing = await this._userDAO.getByUuid(uuid);
      if (!existing || !existing.id) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      const result = await this._userDAO.delete(existing.id);

      if (result) {
        res.status(200).json({
          success: true,
          message: "User deleted successfully",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Failed to delete user",
        });
      }
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Get user with company details
   */
  public async getWithCompany(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { uuid } = req.params;
      const result = await this._userDAO.getUserWithCompany(uuid);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "User not found",
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
   * Get user by email
   */
  public async getByEmail(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { email } = req.params;
      const result = await this._userDAO.getUserByEmail(email);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      // Remove password from response
      const { password, ...userWithoutPassword } = result;

      res.status(200).json({
        success: true,
        data: userWithoutPassword,
      });
    } catch (err: any) {
      next(err);
    }
  }
}
