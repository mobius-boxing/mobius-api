import { Request, Response, NextFunction } from "express";
import { UserDAO } from "../../dao/user/user.dao";
import { FileStorageService } from "../../services/file-storage.service";
import { sniffImageType } from "../../utils/image-sniff";

const AVATAR_CACHE_CONTROL = "public, max-age=300";

/**
 * Public, UNAUTHENTICATED avatar images. The uuid in the URL is a capability:
 * it is regenerated on every upload and only objects recorded on a users row
 * can be served (never an arbitrary storage key). Unknown uuid is a generic 404.
 */
export class AvatarController {
  private userDAO = new UserDAO();
  private storage = new FileStorageService();

  public async get(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const row = await this.userDAO.getByAvatarUuid(req.params.avatarUuid);
      if (!row) {
        res.status(404).json({ success: false, message: "Not found" });
        return;
      }
      const key = this.storage.buildAvatarKey(row.avatarUuid);

      res.setHeader("Cache-Control", AVATAR_CACHE_CONTROL);
      // helmet's same-origin CORP would block the SPAs (other origins) from painting this.
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

      const url = await this.storage.getDownloadUrl(key);
      if (url) {
        res.redirect(302, url);
        return;
      }
      if (!(await this.storage.localObjectExists(key))) {
        res.status(404).json({ success: false, message: "Not found" });
        return;
      }
      res.setHeader("Content-Type", row.avatarContentType);
      this.storage.getLocalReadStream(key).pipe(res);
    } catch (err: any) {
      next(err);
    }
  }

  /**
   * Customers are tenant data and a public request carries no tenant, so there is
   * no row lookup: the uuid is the capability and the object under
   * `customer-avatars/` is the only thing that can be served.
   */
  public async getCustomer(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const key = this.storage.buildCustomerAvatarKey(req.params.avatarUuid);

      if (!(await this.storage.objectExists(key))) {
        res.status(404).json({ success: false, message: "Not found" });
        return;
      }

      res.setHeader("Cache-Control", AVATAR_CACHE_CONTROL);
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

      const url = await this.storage.getDownloadUrl(key);
      if (url) {
        res.redirect(302, url);
        return;
      }
      const bytes = await this.storage.getObjectBuffer(key);
      res.setHeader("Content-Type", sniffImageType(bytes) ?? "image/jpeg");
      res.send(bytes);
    } catch (err: any) {
      next(err);
    }
  }
}
