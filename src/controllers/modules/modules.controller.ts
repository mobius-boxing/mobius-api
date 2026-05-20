import { Request, Response, NextFunction } from "express";
import { ModuleDAO } from "../../dao/module/module.dao";

export class ModulesController {
  private _moduleDAO: ModuleDAO = new ModuleDAO();

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const modules = await this._moduleDAO.getAll();
      res.status(200).json({ success: true, data: modules });
    } catch (err: any) {
      next(err);
    }
  }
}
