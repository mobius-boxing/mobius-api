import { Request } from "express";
import { paginationHelper } from "@sundaysf/utils";
import {
  STORE_ORDER_STATUSES,
  StoreOrderStatus,
} from "../interfaces/store-order/store-order.interfaces";
import { IStoreOrderListParams } from "../dao/store-order/store-order.dao";

// Shared parser for both store-order list endpoints (admin + customer). Single
// source of truth for how list query params are read/validated, so the two
// endpoints can never diverge:
//   - page/limit via paginationHelper (defaults page=1, limit=20, capped at 20)
//   - status (optional) validated against STORE_ORDER_STATUSES — invalid → error
//   - search (optional) trimmed; empty becomes undefined
//   - sortBy in {createdAt,status} (default createdAt); sortOrder in {asc,desc} (default desc)
//
// Returns either the parsed params or a validation error string (caller 400s).
export function parseStoreOrderListParams(
  req: Request,
): { ok: true; params: IStoreOrderListParams } | { ok: false; error: string } {
  const { page, limit } = paginationHelper(req);

  let status: StoreOrderStatus | undefined;
  const rawStatus = req.query.status;
  if (rawStatus !== undefined && rawStatus !== "") {
    if (
      typeof rawStatus !== "string" ||
      !STORE_ORDER_STATUSES.includes(rawStatus as StoreOrderStatus)
    ) {
      return { ok: false, error: "Invalid status" };
    }
    status = rawStatus as StoreOrderStatus;
  }

  let search: string | undefined;
  const rawSearch = req.query.search;
  if (typeof rawSearch === "string" && rawSearch.trim().length > 0) {
    search = rawSearch.trim();
  }

  const rawSortBy = req.query.sortBy;
  const sortBy: "createdAt" | "status" =
    rawSortBy === "status" ? "status" : "createdAt";

  const rawSortOrder = req.query.sortOrder;
  const sortOrder: "asc" | "desc" = rawSortOrder === "asc" ? "asc" : "desc";

  return {
    ok: true,
    params: { page, limit, status, search, sortBy, sortOrder },
  };
}
