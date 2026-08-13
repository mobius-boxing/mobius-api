import { NextFunction, Request, Response } from "express";
import { CompanyDAO } from "../../dao/company/company.dao";
import { CountdownPeopleDAO } from "../../dao/countdown/countdown-people.dao";
import { getCompanyScope } from "../../utils/companyScope";

/**
 * `/api/countdown/people` — the roster the assignment picker draws from: the
 * company's active users as `{uuid, name}`.
 *
 * It exists because `GET /api/users` is admin-only while assigning a resolver or
 * a watcher is an everyday action for any module user. Read-only, no pagination
 * (a picker reads the whole list), and it exposes nothing but a name.
 */
export class CountdownPeopleController {
  private _dao = new CountdownPeopleDAO();
  private _companyDAO = new CompanyDAO();

  public async list(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      // Non-superAdmins get their JWT company; a superAdmin must name one with
      // ?companyId=<uuid>. Another company's roster is never reachable.
      const { companyUuid } = getCompanyScope(req);
      const companyId = companyUuid
        ? await this._companyDAO.getIdByUuid(companyUuid)
        : null;
      if (companyId === null) {
        req.statusCode = 400;
        return next(new Error("Empresa no encontrada"));
      }

      const data = await this._dao.list(companyId);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
}
