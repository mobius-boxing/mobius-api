/**
 * The pedido approval vocabulary — the SINGLE source shared by the router, the
 * controller and the DAO so the three can never drift on what a machine is or
 * which catalogue code gates it.
 *
 * Only the two approval machines live here. Cumplimiento and anulación are
 * separate features with their own column pairs and are deliberately absent.
 */
export const ORDER_APPROVAL_MACHINES = ["commercial", "financial"] as const;

export type OrderApprovalMachine = (typeof ORDER_APPROVAL_MACHINES)[number];

/**
 * `:machine` → its pre-existing catalogue code
 * (permissions-catalog.ts:728 / :734), or `null` for anything else.
 *
 * Pure and total: the router answers 400 on `null` BEFORE requirePermission
 * runs, so an unknown machine never reaches a permission check or the database.
 */
export function orderApprovalPermissionCode(machine: string): string | null {
  return (ORDER_APPROVAL_MACHINES as readonly string[]).includes(machine)
    ? `orders.approve.${machine}`
    : null;
}
