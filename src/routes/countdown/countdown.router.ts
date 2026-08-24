import { Router } from "express";
import { CountdownDocumentController } from "../../controllers/countdown/countdown-document.controller";
import { CountdownCategoryController } from "../../controllers/countdown/countdown-category.controller";
import { CountdownGroupController } from "../../controllers/countdown/countdown-group.controller";
import { CountdownPeopleController } from "../../controllers/countdown/countdown-people.controller";
import { CountdownReminderController } from "../../controllers/countdown/countdown-reminder.controller";
import {
  authenticate,
  requireCountdownModule,
  requirePermission,
  requireSuperAdmin,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  sensitiveRateLimiter,
  sensitiveCountdownDeletionRateLimiter,
} from "../../middlewares";

/**
 * /api/countdown — document-expiration tracking (auto-mounted by IndexRouter:
 * folder name = route path).
 *
 * Two tiers of gate, deliberately:
 *
 *  - `countdown.manage` (requirePermission) covers the *administrative* surface:
 *    deleting documents, assigning who may resolve them, and managing rubros and
 *    grupos. These are the actions the standalone app reserved for its admins.
 *  - Everything else — filing, editing, resolving and exporting documents, plus
 *    reading the rubro/grupo/people pickers those screens need — is open to any
 *    module user of the company. This is a conscious deviation from the blanket
 *    "writes are permission-gated" rule: countdown's product model is that the
 *    whole team files and resolves documents, and RbacService's transition
 *    fallback treats a role-less user as denied for any code, which would lock
 *    out every plain member. Authorization on those routes is still real — it
 *    lives one layer down in `canResolve`, which the service re-checks on every
 *    status change.
 *
 * `requireCountdownModule` runs on every route (including reads): a company
 * without the module gets 403 regardless of who is asking. It also pins the
 * company — superAdmins must pass ?companyId=<uuid>.
 */
export class CountdownRouter {
  public router: Router = Router();
  private readonly documents = new CountdownDocumentController();
  private readonly categories = new CountdownCategoryController();
  private readonly groups = new CountdownGroupController();
  private readonly people = new CountdownPeopleController();
  private readonly reminders = new CountdownReminderController();

  constructor() {
    this.initRoutes();
  }

  private initRoutes(): void {
    const documents = this.documents;
    const categories = this.categories;
    const groups = this.groups;
    const people = this.people;
    const reminders = this.reminders;

    // ---- documents ------------------------------------------------------
    this.router.get(
      "/documents",
      authenticate,
      requireCountdownModule,
      validatePagination,
      apiRateLimiter,
      documents.list.bind(documents),
    );
    // Literal segments registered before /documents/:uuid so they win the match.
    this.router.get(
      "/documents/summary",
      authenticate,
      requireCountdownModule,
      apiRateLimiter,
      documents.summary.bind(documents),
    );
    this.router.get(
      "/documents/export",
      authenticate,
      requireCountdownModule,
      apiRateLimiter,
      documents.exportXlsx.bind(documents),
    );
    this.router.post(
      "/documents",
      authenticate,
      requireCountdownModule,
      apiRateLimiter,
      documents.create.bind(documents),
    );
    this.router.get(
      "/documents/:uuid",
      authenticate,
      requireCountdownModule,
      validateUUID(),
      apiRateLimiter,
      documents.getByUuid.bind(documents),
    );
    this.router.patch(
      "/documents/:uuid",
      authenticate,
      requireCountdownModule,
      validateUUID(),
      apiRateLimiter,
      documents.update.bind(documents),
    );
    this.router.patch(
      "/documents/:uuid/status",
      authenticate,
      requireCountdownModule,
      validateUUID(),
      apiRateLimiter,
      documents.setStatus.bind(documents),
    );
    this.router.put(
      "/documents/:uuid/assignments",
      authenticate,
      requireCountdownModule,
      requirePermission("countdown.manage"),
      validateUUID(),
      apiRateLimiter,
      documents.setAssignments.bind(documents),
    );
    this.router.delete(
      "/documents/:uuid",
      authenticate,
      requireCountdownModule,
      requirePermission("countdown.manage"),
      validateUUID(),
      sensitiveCountdownDeletionRateLimiter,
      documents.delete.bind(documents),
    );

    // ---- rubros (categories + subcategories) ----------------------------
    // A rubro is required to file a document, so every module user needs the list.
    this.router.get(
      "/categories",
      authenticate,
      requireCountdownModule,
      apiRateLimiter,
      categories.list.bind(categories),
    );
    this.router.post(
      "/categories",
      authenticate,
      requireCountdownModule,
      requirePermission("countdown.manage"),
      apiRateLimiter,
      categories.create.bind(categories),
    );
    this.router.post(
      "/categories/:uuid/subcategories",
      authenticate,
      requireCountdownModule,
      requirePermission("countdown.manage"),
      validateUUID(),
      apiRateLimiter,
      categories.createSubcategory.bind(categories),
    );
    this.router.patch(
      "/categories/:uuid",
      authenticate,
      requireCountdownModule,
      requirePermission("countdown.manage"),
      validateUUID(),
      apiRateLimiter,
      categories.rename.bind(categories),
    );
    this.router.delete(
      "/categories/:uuid",
      authenticate,
      requireCountdownModule,
      requirePermission("countdown.manage"),
      validateUUID(),
      sensitiveCountdownDeletionRateLimiter,
      categories.delete.bind(categories),
    );
    this.router.patch(
      "/subcategories/:uuid",
      authenticate,
      requireCountdownModule,
      requirePermission("countdown.manage"),
      validateUUID(),
      apiRateLimiter,
      categories.renameSubcategory.bind(categories),
    );
    this.router.delete(
      "/subcategories/:uuid",
      authenticate,
      requireCountdownModule,
      requirePermission("countdown.manage"),
      validateUUID(),
      sensitiveCountdownDeletionRateLimiter,
      categories.deleteSubcategory.bind(categories),
    );

    // ---- grupos ---------------------------------------------------------
    this.router.get(
      "/groups",
      authenticate,
      requireCountdownModule,
      apiRateLimiter,
      groups.list.bind(groups),
    );
    this.router.post(
      "/groups",
      authenticate,
      requireCountdownModule,
      requirePermission("countdown.manage"),
      apiRateLimiter,
      groups.create.bind(groups),
    );
    this.router.put(
      "/groups/:uuid/members",
      authenticate,
      requireCountdownModule,
      requirePermission("countdown.manage"),
      validateUUID(),
      apiRateLimiter,
      groups.setMembers.bind(groups),
    );
    this.router.patch(
      "/groups/:uuid",
      authenticate,
      requireCountdownModule,
      requirePermission("countdown.manage"),
      validateUUID(),
      apiRateLimiter,
      groups.rename.bind(groups),
    );
    this.router.delete(
      "/groups/:uuid",
      authenticate,
      requireCountdownModule,
      requirePermission("countdown.manage"),
      validateUUID(),
      sensitiveCountdownDeletionRateLimiter,
      groups.delete.bind(groups),
    );

    // ---- people (assignment picker roster) ------------------------------
    // GET /api/users is admin-only, so the picker gets its own read-only roster
    // of the company's active users.
    this.router.get(
      "/people",
      authenticate,
      requireCountdownModule,
      apiRateLimiter,
      people.list.bind(people),
    );

    // ---- reminders ------------------------------------------------------
    // Manual trigger for the daily batch. Kept because the scheduler only works
    // once per weekday at 08:00 Buenos Aires and QA cannot wait for that; the
    // daily claim still applies, so a second call the same day is a no-op.
    this.router.post(
      "/reminders/run",
      authenticate,
      requireCountdownModule,
      requireSuperAdmin(),
      sensitiveRateLimiter,
      reminders.runNow.bind(reminders),
    );
  }
}
