/**
 * Store Order State Machine Tests
 * Pure unit tests for the single-source-of-truth lifecycle helpers.
 */

import { describe, it, expect } from "@jest/globals";
import {
  STORE_ORDER_FLOW,
  STORE_ORDER_STATUSES,
  STORE_ORDER_ADMIN_TRANSITIONS,
  canAdminTransition,
  StoreOrderStatus,
} from "../../../interfaces/store-order/store-order.interfaces";

describe("Store order status constants", () => {
  it("STORE_ORDER_FLOW is the linear happy path in order", () => {
    expect([...STORE_ORDER_FLOW]).toEqual([
      "pending",
      "confirmed",
      "in_production",
      "shipped",
      "delivered",
    ]);
  });

  it("STORE_ORDER_STATUSES is the flow plus cancelled", () => {
    expect([...STORE_ORDER_STATUSES]).toEqual([
      "pending",
      "confirmed",
      "in_production",
      "shipped",
      "delivered",
      "cancelled",
    ]);
  });

  it("includes cancelled as a valid status", () => {
    expect(STORE_ORDER_STATUSES.includes("cancelled")).toBe(true);
  });
});

describe("canAdminTransition", () => {
  // Legal admin transitions: advance one step, or cancel while pre-shipped.
  const legal: Array<[StoreOrderStatus, StoreOrderStatus]> = [
    ["pending", "confirmed"],
    ["pending", "cancelled"],
    ["confirmed", "in_production"],
    ["confirmed", "cancelled"],
    ["in_production", "shipped"],
    ["in_production", "cancelled"],
    ["shipped", "delivered"],
  ];

  it.each(legal)("allows %s -> %s", (from, to) => {
    expect(canAdminTransition(from, to)).toBe(true);
  });

  // Illegal: skipping steps, going backwards, cancelling after shipped,
  // and any transition out of a terminal state.
  const illegal: Array<[StoreOrderStatus, StoreOrderStatus]> = [
    ["pending", "in_production"], // skip a step
    ["pending", "shipped"], // skip steps
    ["confirmed", "pending"], // backwards
    ["in_production", "confirmed"], // backwards
    ["shipped", "cancelled"], // cancel after shipped not allowed
    ["shipped", "in_production"], // backwards
    ["delivered", "shipped"], // terminal
    ["delivered", "cancelled"], // terminal
    ["cancelled", "pending"], // terminal
    ["cancelled", "confirmed"], // terminal
    ["pending", "pending"], // no-op is not a transition
  ];

  it.each(illegal)("rejects %s -> %s", (from, to) => {
    expect(canAdminTransition(from, to)).toBe(false);
  });

  it("returns false for unknown statuses", () => {
    expect(canAdminTransition("bogus" as StoreOrderStatus, "confirmed")).toBe(
      false,
    );
    expect(canAdminTransition("pending", "bogus" as StoreOrderStatus)).toBe(
      false,
    );
  });

  it("delivered and cancelled are terminal (no outgoing transitions)", () => {
    expect(STORE_ORDER_ADMIN_TRANSITIONS.delivered).toEqual([]);
    expect(STORE_ORDER_ADMIN_TRANSITIONS.cancelled).toEqual([]);
  });

  it("every status in STORE_ORDER_STATUSES has a transition entry", () => {
    for (const status of STORE_ORDER_STATUSES) {
      expect(Array.isArray(STORE_ORDER_ADMIN_TRANSITIONS[status])).toBe(true);
    }
  });
});
