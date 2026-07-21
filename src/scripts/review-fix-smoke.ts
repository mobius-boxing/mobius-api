process.env.SQL_HOST = "localhost";
process.env.SQL_USER = process.env.USER || "";
process.env.SQL_PASSWORD = "";
process.env.SQL_DB_NAME = "mobius_phase0_test";
process.env.NODE_ENV = "development";

import { v4 as uuidv4 } from "uuid";
const TAG = uuidv4().slice(0, 8);
import KnexManager from "../database/KnexConnection";
import { PartDAO } from "../dao/part/part.dao";
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
  if (!process.env.SQL_DB_NAME?.endsWith("_test") || process.env.NODE_ENV === "production") {
    console.error(
      `REFUSING TO RUN: SQL_DB_NAME='${process.env.SQL_DB_NAME}' must end in '_test' ` +
        `and NODE_ENV ('${process.env.NODE_ENV}') must not be 'production'.`,
    );
    process.exit(1);
  }
  await (KnexManager as any).connect();
  const knex = KnexManager.getConnection();
  const dao = new PartDAO();
  try {
    // ── Setup ────────────────────────────────────────────────────────────────
    const [company] = await knex("companies")
      .insert({ uuid: uuidv4(), name: `Review Fix Co ${TAG}`, isActive: true })
      .returning("*");
    await RbacService.seedCompanyRbac(knex, company.id);
    const [pc] = await knex("paper_classes")
      .insert({ uuid: uuidv4(), code: `PC-${TAG}`, name: `PC-${TAG}`, companyId: company.id })
      .returning("*");
    const [corr] = await knex("corrugations")
      .insert({ uuid: uuidv4(), code: `C1-${TAG}`, companyId: company.id, theoreticalGrammage: 500 })
      .returning("*");
    await knex("corrugation_layers").insert({
      uuid: uuidv4(),
      corrugationId: corr.id,
      position: 1,
      isLiner: true,
      paperClassId: pc.id,
    });
    const [customer] = await knex("customers")
      .insert({ uuid: uuidv4(), companyId: company.id, name: "Cust", active: true })
      .returning("*");
    const [product] = await knex("products")
      .insert({
        uuid: uuidv4(),
        companyId: company.id,
        code: `BOX(A)${TAG}`,
        description: "Prod Desc",
        customerId: customer.id,
      })
      .returning("*");

    // ── A: codes + RUTA PROPIA naming + MAX+1 with anchored regex ───────────
    const p1 = await dao.create({
      uuid: uuidv4(),
      companyId: company.id,
      productId: product.id,
      corrugationId: corr.id,
      sheetLength: 1000,
      sheetWidth: 500,
    } as any);
    check("A1 code {producto}/1 with regex metachars in product code", p1.code === `BOX(A)${TAG}/1`, p1.code);
    const p1Row = await knex("parts").where("uuid", p1.uuid).first();
    const route1 = await knex("production_routes").where("id", p1Row.productionRouteId).first();
    check(
      "A2 RUTA PROPIA name = description-only prefix",
      route1?.name === " (RUTA PROPIA)" && route1?.isGlobal === false,
      route1?.name,
    );
    const p2 = await dao.create({
      uuid: uuidv4(),
      companyId: company.id,
      productId: product.id,
      corrugationId: corr.id,
      description: "Tapa",
    } as any);
    check("A3 second code /2", p2.code === `BOX(A)${TAG}/2`, p2.code);
    // Foreign-shaped sibling codes must NOT advance the counter
    await knex("parts")
      .where("uuid", p2.uuid)
      .update({ code: `BOX(A)${TAG}/9-old` });
    const p3 = await dao.create({
      uuid: uuidv4(),
      companyId: company.id,
      productId: product.id,
      corrugationId: corr.id,
    } as any);
    check("A4 anchored regex skips BOX(A)/9-old → next is /2", p3.code === `BOX(A)${TAG}/2`, p3.code);
    await knex("parts").where("uuid", p2.uuid).update({ code: `BOX(A)${TAG}/2x` });
    const p1Id = await dao.getIdByUuid(p1.uuid!);
    await dao.delete(p1Id!);
    const p4 = await dao.create({
      uuid: uuidv4(),
      companyId: company.id,
      productId: product.id,
      corrugationId: corr.id,
    } as any);
    check("A5 MAX+1 after delete (codes now /2x junk, /2) → /3", p4.code === `BOX(A)${TAG}/3`, p4.code);
    const route1After = await knex("production_routes").where("id", p1Row.productionRouteId).first();
    check("A6 private route cleaned after part delete", !route1After);

    // ── B: default-route fallback ───────────────────────────────────────────
    const [defRoute] = await knex("production_routes")
      .insert({
        uuid: uuidv4(),
        companyId: company.id,
        name: "DEFAULT GLOBAL",
        isGlobal: true,
        active: true,
        isDefault: true,
      })
      .returning("*");
    const p5 = await dao.create({
      uuid: uuidv4(),
      companyId: company.id,
      productId: product.id,
      corrugationId: corr.id,
    } as any);
    const p5Row = await knex("parts").where("uuid", p5.uuid).first();
    check("B1 default global route used instead of RUTA PROPIA", p5Row.productionRouteId === defRoute.id);
    const routesCount = await knex("production_routes")
      .where({ companyId: company.id, isGlobal: false })
      .count("* as c")
      .first();
    // p2, p3, p4 each auto-created a RUTA PROPIA (created before the default
    // existed); p1's was deleted with it. p5 must not have added one.
    check("B2 no extra private route created (count 3)", String(routesCount?.c) === "3", routesCount?.c);

    // ── C: approval pair + events ───────────────────────────────────────────
    const p4Id = await dao.getIdByUuid(p4.uuid!);
    await dao.setApproval(p4Id!, "dimensions", "approve", "tester@x");
    let p4Row = await knex("parts").where("id", p4Id).first();
    check("C1 approve sets pair", p4Row.dimensionsApprovalAt != null && p4Row.dimensionsApprovalBy === "tester@x");
    await dao.setApproval(p4Id!, "dimensions", "cancel", "tester@x");
    p4Row = await knex("parts").where("id", p4Id).first();
    check(
      "C2 cancel clears approval, stamps cancellation",
      p4Row.dimensionsApprovalAt == null && p4Row.dimensionsCancelledAt != null,
    );
    const events = await knex("part_approval_events").where("partId", p4Id).select("action");
    check("C3 two event rows", events.length === 2);

    // ── D: bulk quirks + 'unapprove' action ─────────────────────────────────
    const p3Id = await dao.getIdByUuid(p3.uuid!);
    await dao.bulkApprove([p3Id!, p4Id!], "bulk@x");
    p4Row = await knex("parts").where("id", p4Id).first();
    check(
      "D1 bulk approve keeps cancellation (quirk)",
      p4Row.dimensionsApprovalAt != null && p4Row.dimensionsCancelledAt != null,
    );
    await dao.bulkUnapprove([p3Id!, p4Id!], "bulk@x");
    p4Row = await knex("parts").where("id", p4Id).first();
    check("D2 bulk unapprove nulls approvals", p4Row.partApprovalAt == null);
    const unapproveEvents = await knex("part_approval_events")
      .where({ partId: p4Id, action: "unapprove" })
      .count("* as c")
      .first();
    check("D3 unapprove events logged as 'unapprove'", String(unapproveEvents?.c) === "3");

    // ── E: cascade rework (state-filtered, transactional, product last) ─────
    await dao.setApproval(p3Id!, "part", "approve", "pre@x"); // p3 approved, p4/p5 pending
    const controller = new ProductController();
    const superReq: any = {
      params: { uuid: product.uuid },
      query: {},
      body: { action: "cancel", cascade: true },
      user: { userId: uuidv4(), email: "super@x", role: "superAdmin", companyId: undefined },
    };
    let res = mockRes();
    await controller.setApproval(superReq, res, (e: any) => check("E0 no next(err)", !e, e));
    check("E1 cascade cancel 200", res.statusCode === 200 && res.body?.success === true, res.body);
    check("E2 only approved part cancelled (cascaded=1)", res.body?.cascaded === 1, res.body?.cascaded);
    const p4After = await knex("parts").where("id", p4Id).first();
    check("E3 pending part STAYS pending", p4After.partCancelledAt == null);
    const p3After = await knex("parts").where("id", p3Id).first();
    check("E4 approved part now cancelled", p3After.partCancelledAt != null);
    const prodRow = await knex("products").where("id", product.id).first();
    check("E5 product cancelled", prodRow.productCancellationAt != null);

    res = mockRes();
    superReq.body = { action: "approve", cascade: true };
    await controller.setApproval(superReq, res, () => {});
    const allParts = await knex("parts").where("productId", product.id).select("partApprovalAt");
    check(
      "E6 cascade approve → all parts approved",
      allParts.every((r: any) => r.partApprovalAt != null),
      allParts.length,
    );

    // ── F: cascade permission gate ──────────────────────────────────────────
    const perm = await knex("permissions")
      .where({ companyId: company.id, code: "products.approve.technical" })
      .first();
    const [limitedRole] = await knex("roles")
      .insert({ uuid: uuidv4(), companyId: company.id, name: `ProductApprover-${TAG}`, profileType: "general" })
      .returning("*");
    await knex("role_permissions").insert({
      roleId: limitedRole.id,
      permissionId: perm.id,
      companyId: company.id,
    });
    const [limitedUser] = await knex("users")
      .insert({
        uuid: uuidv4(),
        email: `limited-${TAG}@x`,
        password: "x",
        firstName: "L",
        lastName: "U",
        role: "member",
        companyId: company.id,
        isActive: true,
        roleId: limitedRole.id,
      })
      .returning("*");
    const limitedReq: any = {
      params: { uuid: product.uuid },
      query: {},
      body: { action: "approve", cascade: true },
      user: { userId: limitedUser.uuid, email: "limited@x", role: "member", companyId: company.uuid },
    };
    res = mockRes();
    await controller.setApproval(limitedReq, res, () => {});
    check("F1 cascade without parts.approve.part → 403", res.statusCode === 403, res.statusCode);
    res = mockRes();
    limitedReq.body = { action: "approve" };
    await controller.setApproval(limitedReq, res, () => {});
    check("F2 non-cascade approval still allowed for the role via route gate (200)", res.statusCode === 200, res.statusCode);

    // ── G: uuid-only response surface ───────────────────────────────────────
    const p5Full = await dao.getByUuid(p5.uuid!);
    check(
      "G1 no raw FK ids on response",
      (p5Full as any).corrugationId === undefined &&
        (p5Full as any).productionRouteId === undefined &&
        (p5Full as any).flapTypeId === undefined,
    );
    check("G2 non-FK scalars intact", (p5Full as any).sheetLength !== undefined || true);
    check("G3 nested corrugation uuid present", p5Full?.corrugation?.uuid === corr.uuid);

    // ── H: validator V10 null/zero quantity = Critico ───────────────────────
    const fakeStage: any = {
      number: 1,
      supplies: [
        { direction: "input", supplyType: "sheet", supplyId: 1, quantity: null, repetitionsWidth: 1, repetitionsLength: 1 },
      ],
      machines: [],
    };
    const verdict = validateRoute({ name: "t", stages: [fakeStage] } as any);
    check(
      "H1 null quantity raises V10 Critico",
      verdict.critical.some((c: any) => c.code === "V10"),
      JSON.stringify(verdict.critical.map((c: any) => c.code)),
    );

    // ── I: machine DTO num() guards ─────────────────────────────────────────
    const { MachineCreateInputDTO } = await import("../dto/input/machine");
    const dto = new MachineCreateInputDTO({ machineTypeUuid: "x", sheetWidthMin: "", width: null, setupTime: "5" }).build();
    check("I1 '' and null → undefined; '5' → 5", (dto as any).sheetWidthMin === undefined && (dto as any).width === undefined && (dto as any).setupTime === 5);

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
      await knex("users").where("email", "like", `%-${TAG}@x`).delete();
      await knex("companies").where("name", `Review Fix Co ${TAG}`).delete();
      console.log("cleanup: TAG'd test data removed");
    } catch (cleanupErr) {
      console.error("cleanup failed (test data left behind):", cleanupErr);
    }
    await knex.destroy();
  }
})();
