/**
 * AC-4 — every router in model.md's route→code mapping uses its mapped code.
 *
 * Two layers, per the brief's own split:
 *  1. static — each router file's `requirePermission(...)` call sites, by
 *     code and by `{ allowReadOnly: true }` presence, counted straight from
 *     source text (the same technique `architecture.test.ts` uses for I-6/I-7,
 *     chosen over mounting all ~40 routers because the routers carry no
 *     branching logic worth exercising through HTTP — the sales-orders
 *     approval router's *dynamic* dispatch already has its own supertest
 *     suite for that reason);
 *  2. behavioral — the Member baseline and a custom readonly role, decided
 *     through `RbacService.isAllowed` directly (the function every one of
 *     these routers' `requirePermission` calls bottoms out into), so this
 *     suite fails the same way a live 200/403 would without booting Express.
 */
import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import { RbacService } from "../../../services/rbac.service";
import { MEMBER_BASELINE_CODES } from "../../../common/constants/permissions-catalog";

const ROUTES = path.join(__dirname, "..", "..", "..", "routes");
const read = (relative: string): string =>
  fs.readFileSync(path.join(ROUTES, relative), "utf8");

/** One row per router file that model.md's mapping table names. */
type RouterCase = {
  file: string;
  code: string;
  /** requirePermission(code, { allowReadOnly: true }) occurrences. */
  readonlyCalls: number;
  /** requirePermission(code) occurrences (no allowReadOnly). */
  writeCalls: number;
};

const ROUTER_CASES: RouterCase[] = [
  {
    file: "box-type/box-type.router.ts",
    code: "box-types.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "color/color.router.ts",
    code: "colors.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "color-type/color-type.router.ts",
    code: "color-types.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "complement/complement.router.ts",
    code: "complements.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "corrugation/corrugation.router.ts",
    code: "corrugated.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "corrugation-class/corrugation-class.router.ts",
    code: "corrugated.classes",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "customer/customer.router.ts",
    code: "customers.edit",
    readonlyCalls: 3,
    writeCalls: 3,
  },
  {
    file: "customer-category/customer-category.router.ts",
    code: "customer-categories.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "delivery-zones/delivery-zones.router.ts",
    code: "delivery-zones.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "delivery-locations/delivery-locations.router.ts",
    code: "delivery-zones.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "finished-goods/finished-goods.router.ts",
    code: "finished-goods.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "flap-type/flap-type.router.ts",
    code: "flap-types.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "flute-type/flute-type.router.ts",
    code: "flute-types.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "fsc-type/fsc-type.router.ts",
    code: "fsc-types.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "glue-type/glue-type.router.ts",
    code: "glue-types.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "manufacturer/manufacturer.router.ts",
    code: "manufacturers.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "paper-class/paper-class.router.ts",
    code: "paper.classes",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "paper-type/paper-type.router.ts",
    code: "paper-types.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "paper-sheet/paper-sheet.router.ts",
    code: "papers.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "paper-supply/paper-supply.router.ts",
    code: "supplies.edit",
    readonlyCalls: 3,
    writeCalls: 3,
  },
  {
    file: "paper-stock/paper-stock.router.ts",
    code: "paper-stock.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "sheet-stock/sheet-stock.router.ts",
    code: "sheet-stock.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "product-type/product-type.router.ts",
    code: "product-types.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "strapping-type/strapping-type.router.ts",
    code: "strapping-types.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "supplier/supplier.router.ts",
    code: "suppliers.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "tooling/tooling.router.ts",
    code: "tooling.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "tooling-type/tooling-type.router.ts",
    code: "tooling-types.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "trace-type/trace-type.router.ts",
    code: "score-types.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "warehouse/warehouse.router.ts",
    code: "warehouses.edit",
    readonlyCalls: 3,
    writeCalls: 3,
  },
  {
    file: "warehouseLocation/warehouseLocation.router.ts",
    code: "warehouses.edit",
    readonlyCalls: 3,
    writeCalls: 4,
  },
  {
    file: "consumable-type/consumable-type.router.ts",
    code: "consumable-types.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "consumable-supply/consumable-supply.router.ts",
    code: "consumable-supplies.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "consumable-stock/consumable-stock.router.ts",
    code: "consumable-stock.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "tooling-stock/tooling-stock.router.ts",
    code: "tooling-stock.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "machine/machine.router.ts",
    code: "machines.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "machine-type/machine-type.router.ts",
    code: "machines.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "models/models.router.ts",
    code: "models.edit",
    readonlyCalls: 3,
    writeCalls: 4,
  },
  {
    file: "pallet-types/pallet-types.router.ts",
    code: "palletizing.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "palletizations/palletizations.router.ts",
    code: "palletizing.edit",
    readonlyCalls: 2,
    writeCalls: 3,
  },
  {
    file: "production-routes/production-routes.router.ts",
    code: "routes.edit",
    readonlyCalls: 2,
    writeCalls: 4,
  },
  {
    file: "users/users.router.ts",
    code: "users.edit",
    readonlyCalls: 2,
    writeCalls: 1,
  },
  {
    file: "invitations/invitations.router.ts",
    code: "users.edit",
    readonlyCalls: 4,
    writeCalls: 3,
  },
];

/** Codes with no readonly variant — the RW call count is the only signal. */
const NO_READONLY_CASES: RouterCase[] = [
  {
    file: "app-config/app-config.router.ts",
    code: "settings.edit",
    readonlyCalls: 0,
    writeCalls: 2,
  },
  {
    file: "files/files.router.ts",
    code: "files.manage",
    readonlyCalls: 0,
    writeCalls: 1,
  },
];

/**
 * `parts` and `product` mix codes on one router, so they get their own count
 * assertions rather than the single-code table above.
 */
const MIXED_CODE_FILES: Array<{
  file: string;
  expected: Record<string, number>;
}> = [
  {
    file: "product/product.router.ts",
    expected: {
      '"products.edit", { allowReadOnly: true }': 3,
      '"products.edit"': 2,
      '"parts.edit", { allowReadOnly: true }': 1,
      '"parts.edit"': 1,
      '"products.approve.technical"': 1,
      '"products.delete"': 1,
    },
  },
  {
    file: "parts/parts.router.ts",
    expected: {
      '"parts.edit", { allowReadOnly: true }': 2,
      '"parts.edit"': 4,
      '"parts.approve.bulk"': 2,
    },
  },
];

const countCalls = (
  contents: string,
  code: string,
  readonly: boolean,
): number => {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = readonly
    ? new RegExp(
        `requirePermission\\(\\s*"${escaped}"\\s*,\\s*\\{\\s*allowReadOnly:\\s*true\\s*\\}\\s*\\)`,
        "g",
      )
    : new RegExp(`requirePermission\\(\\s*"${escaped}"\\s*\\)`, "g");
  return (contents.match(re) ?? []).length;
};

describe("AC-4 — router → code mapping (static)", () => {
  it.each([...ROUTER_CASES, ...NO_READONLY_CASES])(
    "$file gates on $code ($readonlyCalls readonly + $writeCalls write calls) and never on requireAdmin",
    ({ file, code, readonlyCalls, writeCalls }) => {
      const contents = read(file);
      expect(countCalls(contents, code, true)).toBe(readonlyCalls);
      expect(countCalls(contents, code, false)).toBe(writeCalls);
      expect(contents).not.toMatch(/requireAdmin\(/);
    },
  );

  it.each(MIXED_CODE_FILES)(
    "$file gates on its mixed codes exactly",
    ({ file, expected }) => {
      const contents = read(file);
      for (const [call, count] of Object.entries(expected)) {
        const re = new RegExp(
          `requirePermission\\(\\s*${call.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\)`,
          "g",
        );
        expect({ call, count: (contents.match(re) ?? []).length }).toEqual({
          call,
          count,
        });
      }
      expect(contents).not.toMatch(/requireAdmin\(/);
    },
  );
});

describe("AC-4 — Member baseline behavior (through RbacService.isAllowed)", () => {
  const member = (code: string, options?: { allowReadOnly?: boolean }) =>
    RbacService.isAllowed(
      "member",
      true,
      [...MEMBER_BASELINE_CODES],
      code,
      options,
    );

  it("200s on consumables CRUD (full RW baseline grant)", () => {
    for (const code of [
      "consumable-types.edit",
      "consumable-supplies.edit",
      "consumable-stock.edit",
      "tooling-stock.edit",
    ]) {
      expect(member(code)).toBe(true); // write (POST/PUT/DELETE)
      expect(member(code, { allowReadOnly: true })).toBe(true); // read
    }
  });

  it("200s on customers GET (readonly baseline grant)", () => {
    expect(member("customers.edit", { allowReadOnly: true })).toBe(true);
  });

  it("403s on customers POST (baseline grant is readonly-only)", () => {
    expect(member("customers.edit")).toBe(false);
  });

  it("403s on box-type GET (not in the baseline at all)", () => {
    expect(member("box-types.edit", { allowReadOnly: true })).toBe(false);
  });
});

describe("AC-4 — custom role with box-types.edit.readonly (through RbacService.isAllowed)", () => {
  const custom = (code: string, options?: { allowReadOnly?: boolean }) =>
    RbacService.isAllowed(
      "member",
      true,
      ["box-types.edit.readonly"],
      code,
      options,
    );

  it("200s GET", () => {
    expect(custom("box-types.edit", { allowReadOnly: true })).toBe(true);
  });

  it("403s POST", () => {
    expect(custom("box-types.edit")).toBe(false);
  });
});
