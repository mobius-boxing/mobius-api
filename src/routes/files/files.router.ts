import { Router } from "express";
import multer from "multer";
import {
  FileController,
  MAX_FILE_SIZE_BYTES,
} from "../../controllers/file/file.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";
import { detachAudit } from "../../middlewares/audit-context.middleware";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

export class FilesRouter {
  public router: Router = Router();
  private readonly controller: FileController = new FileController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    this.router.get(
      "/",
      authenticate,
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this.controller.getAll.bind(this.controller),
    );
    this.router.post(
      "/",
      authenticate,
      // AUDIT (P1): the upload streams the bytes to S3 inside the request. A
      // pooled Postgres connection may not be held across that round trip
      // (risk R1), so this route stays on autocommit.
      detachAudit,
      apiRateLimiter,
      upload.single("file"),
      this.controller.upload.bind(this.controller),
    );
    this.router.get(
      "/:uuid",
      authenticate,
      validateUUID(),
      apiRateLimiter,
      this.controller.getByUuid.bind(this.controller),
    );
    this.router.get(
      "/:uuid/download",
      authenticate,
      validateUUID(),
      apiRateLimiter,
      this.controller.download.bind(this.controller),
    );
    this.router.post(
      "/:uuid/copy",
      authenticate,
      // AUDIT (P1, ruling D2): `copy` does an S3 `copyObject` — same class as
      // the upload above, same reason to stay outside the ambient transaction.
      detachAudit,
      validateUUID(),
      apiRateLimiter,
      this.controller.copy.bind(this.controller),
    );
    this.router.delete(
      "/:uuid",
      authenticate,
      validateUUID(),
      sensitiveRateLimiter,
      this.controller.delete.bind(this.controller),
    );
  }
}
