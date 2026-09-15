import { NextFunction, Request, Response } from "express";
import { ENTITY_READ_PERMISSION } from "../database/audit-coverage";

/**
 * The catalogue code that opens the whole ledger (P3 §P3.3, seeded by T2's
 * migration). Kept private: routers name their codes as literals, exactly as
 * every other router does, and this file is the only place the *fallback*
 * semantics live.
 */
const AUDIT_READ_CODE = "audit.read";

/**
 * `GET /audit-logs/history/:entityName/:entityUuid` — who may open one
 * record's history (audit P3, track T5; ruling R-1, AC-7, AC-9).
 *
 * A user passes when they hold **`audit.read`** (the ledger-wide code) **or**
 * the code in `ENTITY_READ_PERMISSION[entityName]` — the code that entity's own
 * routes enforce. When that entry is `null`, `audit.read` is the only door
 * (handbook §P3.4): the catalogue seeds it to every RW-holding Admin, so an
 * Admin's reach is unchanged, and a custom role sees exactly what it was
 * granted — nothing implied by a `role` string that no longer gates routes.
 *
 * An **unknown** `entityName` resolves to `null` too, so it is denied unless
 * the caller holds `audit.read` — the gate leaks no schema, exactly like
 * `applyFilters`, and cannot be told apart from a real table with no
 * dedicated code.
 *
 * **L-008.** The user is never loaded through `UserDAO.getByUuid`:
 * `mapToInterface` drops `roleId`, which would silently disable the whole
 * grid. Authorization is resolved through `RbacService.authzForUserUuid` and
 * decided by `RbacService.isAllowed`, reusing the per-request cache
 * `requirePermission` fills (`auth.middleware.ts:170-210`) so two gates on one
 * request cost one query.
 *
 * `allowReadOnly` is on for both codes: opening a history is a read, so
 * `parts.edit.readonly` must reach `parts` history the same way it reaches the
 * parts list. (`audit.read` has no `.readonly` variant seeded today —
 * `MOBIUS_ADDED_PERMISSIONS` are RW-only — the flag simply mirrors the list
 * endpoint's gate so the two cannot drift.)
 */
export const requireEntityHistoryAccess = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
    return;
  }

  // Same fetch-skipping fast path as `requirePermission`; the decision itself
  // still lives in `RbacService.isAllowed` for everyone else.
  if (user.role === "superAdmin") {
    next();
    return;
  }

  // `?? null` folds the unknown-table case into the `null` branch — see above.
  const entityName = req.params.entityName ?? "";
  const entityCode = ENTITY_READ_PERMISSION[entityName] ?? null;

  try {
    const { RbacService } = await import("../services/rbac.service");

    let codes: string[] | undefined = req.permissionCodes;
    if (codes === undefined) {
      const authz = await RbacService.authzForUserUuid(user.userId);
      codes = authz.codes;
      req.permissionCodes = codes;
    }

    const options = { allowReadOnly: true };
    const allowed =
      RbacService.isAllowed(user.role, codes, AUDIT_READ_CODE, options) ||
      (entityCode !== null &&
        RbacService.isAllowed(user.role, codes, entityCode, options));

    if (!allowed) {
      res.status(403).json({
        success: false,
        // Identical for a `null` entry and for an unknown table, so the message
        // cannot be used to probe which tables exist.
        message:
          entityCode === null
            ? `Insufficient permissions. Required: ${AUDIT_READ_CODE}`
            : `Insufficient permissions. Required: ${AUDIT_READ_CODE} or ${entityCode}`,
      });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
};
