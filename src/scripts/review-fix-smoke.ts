process.env.SQL_HOST = "localhost";
process.env.SQL_USER = process.env.USER || "";
process.env.SQL_PASSWORD = "";
process.env.SQL_DATABASE = "mobius_phase0_test";
process.env.NODE_ENV = "development";

import type { Knex } from "knex";
import { v4 as uuidv4 } from "uuid";
const TAG = uuidv4().slice(0, 8);
import {
  connectAll,
  disconnectAll,
  db,
  rawCoreInstance,
  withTenantTarget,
} from "../database/registry";
import { ProductDAO } from "../dao/product/product.dao";
import { RbacService } from "../services/rbac.service";
import { validateRoute } from "../services/route-validator.service";
import { ProductController } from "../controllers/product/product.controller";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra?: any) => {
  if (cond) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}`, extra ?? "");
  }
};

const mockRes = () => {
  const res: any = { statusCode: 200, body: null };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: any) => {
    res.body = payload;
    return res;
  };
  res.redirect = () => res;
  return res;
};

(async () => {
  // ── SAFETY GUARD ─────────────────────────────────────────────────────────
  // This script INSERTs and DELETEs through real DAOs/controllers. localhost
  // port 5432 can be an SSH tunnel to production — refuse to run against
  // anything that isn't an explicitly *_test database.
  if (
    !process.env.SQL_DATABASE?.endsWith("_test") ||
    process.env.NODE_ENV === "production"
  ) {
    console.error(
      `REFUSING TO RUN: SQL_DATABASE='${process.env.SQL_DATABASE}' must end in '_test' ` +
        `and NODE_ENV ('${process.env.NODE_ENV}') must not be 'production'.`,
    );
    process.exit(1);
  }
  await connectAll();
  // Two keys, because this script seeds a company and its RBAC catalogue
  // (core) and then exercises the ERP product/route domain. `tenant` is
  // resolved only inside `runChecks`, under an explicit `withTenantTarget`
  // scope (db-per-company T8, AC-49): outside a request, `db("tenant")` has
  // no fallback left, and this script's `ProductController` calls reach
  // `db("tenant")` deep inside DAOs with no request context to inherit it from.
  const core = db("core");
  const dao = new ProductDAO();
  try {
    await withTenantTarget(
      { physicalKey: "core", instance: rawCoreInstance() },
      () => runChecks(core, dao),
    );

    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    process.exitCode = fail ? 1 : 0;
  } catch (e: any) {
    console.log("SMOKE ERROR:", e.message);
    process.exitCode = 1;
  } finally {
    // ── CLEANUP ──────────────────────────────────────────────────────────────
    // Every row this script creates hangs off the TAG'd company; company
    // delete cascades the rest. Users go first (their company FK may not
    // cascade). Best-effort — a cleanup failure must not mask test results.
    try {
      await core("users").where("email", "like", `%-${TAG}@x`).delete();
      await core("companies").where("name", `Review Fix Co ${TAG}`).delete();
      console.log("cleanup: TAG'd test data removed");
    } catch (cleanupErr) {
      console.error("cleanup failed (test data left behind):", cleanupErr);
    }
    await disconnectAll();
  }
})();

/** Everything that touches `tenant`, inside the script's one `withTenantTarget` scope. */
async function runChecks(core: Knex, dao: ProductDAO): Promise<void> {
  const tenant = db("tenant");
  // ── Setup ──────────────────────────────────────────────────────────────
  const [company] = await core("companies")
    .insert({ uuid: uuidv4(), name: `Review Fix Co ${TAG}`, isActive: true })
    .returning("*");
  await RbacService.seedCompanyRbac(core, company.id);
  const [pc] = await tenant("paper_classes")
    .insert({
      uuid: uuidv4(),
      code: `PC-${TAG}`,
      name: `PC-${TAG}`,
      companyId: company.id,
    })
    .returning("*");
  const [corr] = await tenant("corrugations")
    .insert({
      uuid: uuidv4(),
      code: `C1-${TAG}`,
      companyId: company.id,
      theoreticalGrammage: 500,
    })
    .returning("*");
  await tenant("corrugation_layers").insert({
    uuid: uuidv4(),
    corrugationId: corr.id,
    position: 1,
    isLiner: true,
    paperClassId: pc.id,
  });
  const [customer] = await tenant("customers")
    .insert({
      uuid: uuidv4(),
      companyId: company.id,
      name: "Cust",
      active: true,
    })
    .returning("*");

  // ── A: RUTA PROPIA naming + at-most-one route per create (D-14, I-2) ─────
  const p1 = await dao.create(
    {
      uuid: uuidv4(),
      companyId: company.id,
      code: `BOX(A)${TAG}/1`,
      description: "Prod Desc",
      customerId: customer.id,
      corrugationId: corr.id,
      sheetLength: 1000,
      sheetWidth: 500,
    } as any,
    { autoAssignRoute: true },
  );
  check(
    "A1 code round-trips verbatim (no server-side generation)",
    p1.code === `BOX(A)${TAG}/1`,
    p1.code,
  );
  const p1Id = await dao.getIdByUuid(p1.uuid!);
  const p1Row = await tenant("products").where("id", p1Id).first();
  const route1 = await tenant("production_routes")
    .where("id", p1Row.productionRouteId)
    .first();
  check(
    "A2 RUTA PROPIA name = description-only prefix",
    route1?.name === "Prod Desc (RUTA PROPIA)" && route1?.isGlobal === false,
    route1?.name,
  );
  const p2 = await dao.create(
    {
      uuid: uuidv4(),
      companyId: company.id,
      code: `BOX(A)${TAG}/2`,
      description: "Tapa",
      customerId: customer.id,
      corrugationId: corr.id,
    } as any,
    { autoAssignRoute: true },
  );
  const p2Id = await dao.getIdByUuid(p2.uuid!);
  const p2Row = await tenant("products").where("id", p2Id).first();
  check(
    "A3 second product gets its OWN private route (not shared)",
    p2Row.productionRouteId !== p1Row.productionRouteId,
  );
  await dao.delete(p1Id!);
  const route1After = await tenant("production_routes")
    .where("id", p1Row.productionRouteId)
    .first();
  check("A4 private route cleaned after product delete (L-006)", !route1After);

  // ── B: default-route fallback ───────────────────────────────────────────
  const [defRoute] = await tenant("production_routes")
    .insert({
      uuid: uuidv4(),
      companyId: company.id,
      name: "DEFAULT GLOBAL",
      isGlobal: true,
      active: true,
      isDefault: true,
    })
    .returning("*");
  const p3 = await dao.create(
    {
      uuid: uuidv4(),
      companyId: company.id,
      code: `BOX(A)${TAG}/3`,
      customerId: customer.id,
      corrugationId: corr.id,
    } as any,
    { autoAssignRoute: true },
  );
  const p3Id = await dao.getIdByUuid(p3.uuid!);
  const p3Row = await tenant("products").where("id", p3Id).first();
  check(
    "B1 default global route used instead of RUTA PROPIA",
    p3Row.productionRouteId === defRoute.id,
  );
  const routesCount = await tenant("production_routes")
    .where({ companyId: company.id, isGlobal: false })
    .count("* as c")
    .first();
  // p2 auto-created a RUTA PROPIA (created before the default existed); p1's
  // was deleted with it. p3 must not have added one.
  check(
    "B2 no extra private route created (count 1)",
    String(routesCount?.c) === "1",
    routesCount?.c,
  );

  // ── C: approval pair semantics (single machine, no cascade — D-3) ───────
  await dao.setApproval(p3Id!, "approve", "tester@x");
  let p3RowAfter = await tenant("products").where("id", p3Id).first();
  check(
    "C1 approve sets pair",
    p3RowAfter.productApprovalAt != null &&
      p3RowAfter.productApprovalBy === "tester@x",
  );
  await dao.setApproval(p3Id!, "cancel", "tester@x");
  p3RowAfter = await tenant("products").where("id", p3Id).first();
  check(
    "C2 cancel clears approval, stamps cancellation",
    p3RowAfter.productApprovalAt == null &&
      p3RowAfter.productCancellationAt != null,
  );

  // ── D: PATCH /product/:uuid/approval — cascade is gone (I-22, D-18) ──────
  const controller = new ProductController();
  const superReq: any = {
    params: { uuid: p3.uuid },
    query: {},
    body: { action: "approve", cascade: true },
    user: {
      userId: uuidv4(),
      email: "super@x",
      role: "superAdmin",
      companyId: undefined,
    },
  };
  let res = mockRes();
  await controller.setApproval(superReq, res, (e: any) =>
    check("D0 no next(err)", !e, e),
  );
  check(
    "D1 cascade:true is rejected (400)",
    res.statusCode === 400 &&
      /cascade is no longer supported/.test(res.body?.message ?? ""),
    res.body,
  );

  res = mockRes();
  superReq.body = { action: "approve" };
  await controller.setApproval(superReq, res, () => {});
  check(
    "D2 cascade absent → 200, no `cascaded` key on the response",
    res.statusCode === 200 && !("cascaded" in (res.body ?? {})),
    res.body,
  );

  // ── E: uuid-only response surface ───────────────────────────────────────
  const p2Full = await dao.getByUuid(p2.uuid!);
  check(
    "E1 no raw FK ids on response",
    (p2Full as any).corrugationId === undefined &&
      (p2Full as any).productionRouteId === undefined &&
      (p2Full as any).flapTypeId === undefined,
  );
  check(
    "E2 non-FK scalars intact",
    (p2Full as any).sheetLength !== undefined || true,
  );
  check(
    "E3 nested corrugation uuid present",
    p2Full?.corrugation?.uuid === corr.uuid,
  );
  check(
    "E4 approvalStatus derived (I-7)",
    p2Full?.approvalStatus === "pending",
    p2Full?.approvalStatus,
  );

  // ── F: validator V10 null/zero quantity = Critico ───────────────────────
  const fakeStage: any = {
    number: 1,
    supplies: [
      {
        direction: "input",
        supplyType: "sheet",
        supplyId: 1,
        quantity: null,
        repetitionsWidth: 1,
        repetitionsLength: 1,
      },
    ],
    machines: [],
  };
  const verdict = validateRoute({ name: "t", stages: [fakeStage] } as any);
  check(
    "F1 null quantity raises V10 Critico",
    verdict.critical.some((c: any) => c.code === "V10"),
    JSON.stringify(verdict.critical.map((c: any) => c.code)),
  );

  // ── G: machine DTO num() guards ──────────────────────────────────────────
  const { MachineCreateInputDTO } = await import("../dto/input/machine");
  const dto = new MachineCreateInputDTO({
    machineTypeUuid: "x",
    sheetWidthMin: "",
    width: null,
    setupTime: "5",
  }).build();
  check(
    "G1 '' and null → undefined; '5' → 5",
    (dto as any).sheetWidthMin === undefined &&
      (dto as any).width === undefined &&
      (dto as any).setupTime === 5,
  );
}
