import { Router } from "express";
import multer from "multer";
import { FileController, MAX_FILE_SIZE_BYTES } from "../../controllers/file/file.controller";
import {
  authenticate,
  requireAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

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
