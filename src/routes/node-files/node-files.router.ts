import { Router } from "express";
import multer from "multer";
import { NodeFilesController } from "../../controllers/node-files/node-files.controller";
import { NF_MAX_UPLOAD_BYTES } from "../../services/node-files/node-files.service";
import {
  authenticate,
  requireModule,
  requirePermission,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
} from "../../middlewares";

/**
 * Memory storage: the bytes go straight to the storage driver and are never
 * written to a temp file. The size limit is multer's, so an oversized upload is
 * refused while it streams instead of after 20 MB have been buffered; the error
 * middleware already maps `LIMIT_FILE_SIZE` to a 400. The MIME allowlist is
 * enforced in the service, where the message can name the offending type.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: NF_MAX_UPLOAD_BYTES },
});

/**
 * /api/node-files — document extraction (auto-mounted by IndexRouter: folder
 * name = route path).
 *
 * `requireModule("node-files")` runs on every route, reads included: a company
 * without the module gets 403 regardless of who is asking. It also pins the
 * company — superAdmins must pass ?companyId=<uuid>.
 *
 * Only DELETE is permission-gated (`node-files.manage`). Building a flow,
 * uploading a document and confirming what came back are everyday actions for
 * any member of a company that has the module — the same product decision
 * countdown made, for the same reason: RbacService denies every code to a
 * role-less user, so gating the everyday surface would lock out plain members.
 * Deleting a flow is the one destructive act, and it is gated.
 */
export class NodeFilesRouter {
  public router: Router = Router();
  private readonly controller = new NodeFilesController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    const controller = this.controller;
    const gate = requireModule("node-files");

    // ---- workflows ------------------------------------------------------
    this.router.get(
      "/workflows",
      authenticate,
      gate,
      validatePagination,
      apiRateLimiter,
      controller.listWorkflows.bind(controller),
    );
    this.router.post(
      "/workflows",
      authenticate,
      gate,
      apiRateLimiter,
      controller.createWorkflow.bind(controller),
    );
    this.router.get(
      "/workflows/:uuid",
      authenticate,
      gate,
      validateUUID(),
      apiRateLimiter,
      controller.getWorkflow.bind(controller),
    );
    this.router.patch(
      "/workflows/:uuid",
      authenticate,
      gate,
      validateUUID(),
      apiRateLimiter,
      controller.updateWorkflow.bind(controller),
    );
    this.router.delete(
      "/workflows/:uuid",
      authenticate,
      gate,
      requirePermission("node-files.manage"),
      validateUUID(),
      sensitiveRateLimiter,
      controller.deleteWorkflow.bind(controller),
    );

    // ---- documents (upload → queued run) --------------------------------
    this.router.post(
      "/workflows/:uuid/documents",
      authenticate,
      gate,
      validateUUID(),
      apiRateLimiter,
      upload.single("file"),
      controller.uploadDocument.bind(controller),
    );

    // ---- runs -----------------------------------------------------------
    this.router.get(
      "/runs",
      authenticate,
      gate,
      validatePagination,
      apiRateLimiter,
      controller.listRuns.bind(controller),
    );
    this.router.get(
      "/runs/:uuid",
      authenticate,
      gate,
      validateUUID(),
      apiRateLimiter,
      controller.getRun.bind(controller),
    );
    this.router.post(
      "/runs/:uuid/review",
      authenticate,
      gate,
      validateUUID(),
      apiRateLimiter,
      controller.reviewRun.bind(controller),
    );
    this.router.post(
      "/runs/:uuid/retry",
      authenticate,
      gate,
      validateUUID(),
      apiRateLimiter,
      controller.retryRun.bind(controller),
    );
  }
}
