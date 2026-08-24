/**
 * AC-5, AC-6, AC-11 (the two guards unreachable through the API), AC-26 and the
 * warning computation, for `production-order-generation.service.ts`.
 *
 * The numbering assertions are the point of this file: they pin the literal
 * strings the pedido-dependent generator produces, so a well-meant "let's just
 * format it here" refactor of the generation service is caught immediately.
 * `CodeGeneratorService.nextValue` is stubbed to the counter values; `next` and
 * `formatDependentCode` stay REAL, because the format is what is under test.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

const trx = { handle: "trx" } as any;

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: () => ({
    transaction: (cb: any) => cb(trx),
  }),
}));

import {
  ProductionOrderGenerationService,
  evaluateGuards,
} from "../../../services/production-order-generation.service";
import { ProductionOrderDAO } from "../../../dao/production-order/production-order.dao";
import { AppConfigService } from "../../../services/app-config.service";
import {
  CodeGeneratorService,
  CODE_SCOPES,
} from "../../../services/code-generator.service";
import { APP_CONFIG_DEFAULTS_BY_KEY } from "../../../common/constants/app-config-defaults";
import {
  PRODUCTION_ORDER_CONFIG_KEYS,
  GUARD_MESSAGES,
} from "../../../interfaces/production-order/production-order.interfaces";
import { GenerateOrdersInputDTO } from "../../../dto/input/production-order";

/** A pedido that clears every guard. `order_data.number` is the AC-5 fixture. */
const approvedSalesOrder = {
  id: 11,
  uuid: "pedido-uuid",
  companyId: 3,
  partId: 42,
  orderDataId: 77,
  quantity: 300,
  deliveryDate: null,
  commercialApprovedAt: new Date("2026-08-01T00:00:00Z"),
  financialApprovedAt: new Date("2026-08-02T00:00:00Z"),
  voidedAt: null,
  fulfilledAt: null,
  fulfilledBy: null,
  purchaseOrderImageFileUuid: null,
  productId: 5,
  orderDataNumber: "00014091",
};

const permissiveConfig = {
  [PRODUCTION_ORDER_CONFIG_KEYS.purchaseOrderImageRequired]: false,
  [PRODUCTION_ORDER_CONFIG_KEYS.oneOrderPerSalesOrder]: false,
  [PRODUCTION_ORDER_CONFIG_KEYS.ordersEnabledByDefault]: false,
};

let insertedRows: any[];

const stubEverything = (overrides: Record<string, unknown> = {}) => {
  insertedRows = [];
  jest
    .spyOn(ProductionOrderDAO.prototype, "lockSalesOrderTrx")
    .mockResolvedValue({ ...approvedSalesOrder, ...overrides } as any);
  jest
    .spyOn(ProductionOrderDAO.prototype, "countByOrderDataId")
    .mockResolvedValue(0);
  jest
    .spyOn(ProductionOrderDAO.prototype, "loadOrderValidationContext")
    .mockResolvedValue({
      routeStageCount: 2,
      partApproved: true,
      customerActive: true,
      productId: 5,
      productCode: "PRD-1",
    });
  jest
    .spyOn(ProductionOrderDAO.prototype, "insertTrx")
    .mockImplementation(async (_trx: any, row: any) => {
      insertedRows.push(row);
      return row;
    });
  jest
    .spyOn(ProductionOrderDAO.prototype, "mapToInterface")
    .mockImplementation((row: any) => row);
  // The post-commit re-read is a join query; this file asserts on what was
  // WRITTEN, so it falls back to the inserted row.
  jest.spyOn(ProductionOrderDAO.prototype, "getByUuid").mockResolvedValue(null);
  jest
    .spyOn(AppConfigService.prototype, "getBool")
    .mockImplementation(async (_companyId: number, key: string) =>
      Boolean((permissiveConfig as Record<string, boolean>)[key]),
    );
  jest.spyOn(AppConfigService.prototype, "getNumber").mockResolvedValue(0);
};

/** Counter values 1, 2, 3 — `next` and the format stay real. */
const stubCounter = () => {
  let counter = 0;
  return jest
    .spyOn(CodeGeneratorService.prototype, "nextValue")
    .mockImplementation(async () => ++counter);
};

const generateRows = (count: number) =>
  Array.from({ length: count }, () => ({ quantity: 100, deliveryDate: null }));

beforeEach(() => {
  stubEverything();
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("numbering is the code generator's, never this file's (AC-5, AC-6)", () => {
  it("produces the pedido-dependent codes literally, unpadded", async () => {
    stubCounter();
    const service = new ProductionOrderGenerationService();

    const outcome = await service.generate({
      salesOrderUuid: "pedido-uuid",
      promisedQuantities: generateRows(3),
      force: false,
      username: "user@x",
    });

    expect(outcome.ok).toBe(true);
    expect(insertedRows.map((row) => row.number)).toEqual([
      "00014091\\1",
      "00014091\\2",
      "00014091\\3",
    ]);
  });

  it("calls next once per row with (companyId, scope, order_data.number) (AC-6)", async () => {
    stubCounter();
    const next = jest.spyOn(CodeGeneratorService.prototype, "next");
    const service = new ProductionOrderGenerationService();

    await service.generate({
      salesOrderUuid: "pedido-uuid",
      promisedQuantities: generateRows(2),
      force: false,
      username: "user@x",
    });

    expect(next).toHaveBeenCalledTimes(2);
    for (const call of next.mock.calls) {
      expect(call).toEqual([3, CODE_SCOPES.productionOrder, "00014091"]);
    }
  });

  it("draws NO number at all when a row fails validation (AC-12 economy)", async () => {
    const nextValue = stubCounter();
    const service = new ProductionOrderGenerationService();

    const outcome = await service.generate({
      salesOrderUuid: "pedido-uuid",
      promisedQuantities: [
        { quantity: 100, deliveryDate: null },
        { quantity: 0, deliveryDate: null },
      ],
      force: false,
      username: "user@x",
    });

    expect(outcome).toEqual({
      ok: false,
      kind: "invalid",
      problems: ["Debe especificar una cantidad mayor que cero!"],
    });
    // Validate-before-number: a rolled-back batch must not burn counter values.
    expect(nextValue).not.toHaveBeenCalled();
    expect(insertedRows).toEqual([]);
  });
});

describe("generated rows copy exactly the documented field set (AC-9, AC-10)", () => {
  it("copies the pedido's fulfillment stamp onto every order (born cumplida)", async () => {
    const fulfilledAt = new Date("2026-07-01T10:00:00Z");
    stubEverything({ fulfilledAt, fulfilledBy: "otro@x" });
    stubCounter();
    const service = new ProductionOrderGenerationService();

    await service.generate({
      salesOrderUuid: "pedido-uuid",
      promisedQuantities: generateRows(1),
      force: false,
      username: "user@x",
    });

    expect(insertedRows[0].completedAt).toBe(fulfilledAt);
    expect(insertedRows[0].completedByUser).toBe("otro@x");
  });

  it("stamps the habilitación pair only when OrdenesHabilitadasPorDefecto is on (AC-10)", async () => {
    stubCounter();
    const service = new ProductionOrderGenerationService();

    await service.generate({
      salesOrderUuid: "pedido-uuid",
      promisedQuantities: generateRows(1),
      force: false,
      username: "user@x",
    });
    expect(insertedRows[0].schedulingApprovedAt).toBeNull();

    jest.restoreAllMocks();
    stubEverything();
    stubCounter();
    jest
      .spyOn(AppConfigService.prototype, "getBool")
      .mockImplementation(
        async (_companyId: number, key: string) =>
          key === PRODUCTION_ORDER_CONFIG_KEYS.ordersEnabledByDefault,
      );

    await new ProductionOrderGenerationService().generate({
      salesOrderUuid: "pedido-uuid",
      promisedQuantities: generateRows(1),
      force: false,
      username: "user@x",
    });

    expect(insertedRows[0].schedulingApprovedAt).toBeInstanceOf(Date);
    expect(insertedRows[0].schedulingApprovedByUser).toBe("user@x");
    expect(insertedRows[0].schedulingCancelledAt).toBeNull();
  });
});

describe("warnings never block (AC-27)", () => {
  it("reports the sum mismatch and still succeeds", async () => {
    stubCounter();
    const service = new ProductionOrderGenerationService();

    const outcome = await service.generate({
      salesOrderUuid: "pedido-uuid",
      // 100 + 100 = 200, the pedido asks for 300.
      promisedQuantities: generateRows(2),
      force: false,
      username: "user@x",
    });

    expect(outcome).toMatchObject({
      ok: true,
      warnings: [
        "La suma de las cantidades no coincide con la cantidad del pedido.",
      ],
    });
  });

  it("stays silent when the quantities add up", async () => {
    stubCounter();
    const service = new ProductionOrderGenerationService();

    const outcome = await service.generate({
      salesOrderUuid: "pedido-uuid",
      promisedQuantities: [
        { quantity: 200, deliveryDate: null },
        { quantity: 100, deliveryDate: null },
      ],
      force: false,
      username: "user@x",
    });

    expect(outcome).toMatchObject({ ok: true, warnings: [] });
  });
});

describe("guard ordering and the two API-unreachable guards (AC-11)", () => {
  const guardInput = (overrides: Record<string, unknown> = {}) => ({
    salesOrder: { ...approvedSalesOrder, ...overrides },
    existingOrderCount: 0,
    promisedQuantities: [{ quantity: 300, deliveryDate: null }],
    force: false,
    config: {
      purchaseOrderImageRequired: false,
      oneOrderPerSalesOrder: false,
    },
  });

  it("passes a fully approved pedido", () => {
    expect(evaluateGuards(guardInput() as any)).toEqual([]);
  });

  it("G5 — a pedido with no order_data (unreachable through the API)", () => {
    const reasons = evaluateGuards(guardInput({ orderDataId: null }) as any);

    expect(reasons[0]).toEqual({
      code: "SALES_ORDER_WITHOUT_ORDER_DATA",
      message: "El pedido no tiene datos de pedido asociados",
    });
  });

  it.each([null, "", "   "])(
    "G6 — order_data.number %p (unreachable through the API)",
    (orderDataNumber) => {
      const reasons = evaluateGuards(guardInput({ orderDataNumber }) as any);

      expect(reasons[0]).toEqual({
        code: "ORDER_DATA_WITHOUT_NUMBER",
        message: "El pedido no tiene número",
      });
    },
  );

  it("returns every failing guard in the spec's evaluation order", () => {
    const reasons = evaluateGuards({
      salesOrder: {
        ...approvedSalesOrder,
        partId: null,
        orderDataId: null,
        orderDataNumber: null,
        commercialApprovedAt: null,
        voidedAt: new Date(),
        purchaseOrderImageFileUuid: null,
      },
      existingOrderCount: 2,
      promisedQuantities: [],
      force: false,
      config: { purchaseOrderImageRequired: true, oneOrderPerSalesOrder: true },
    } as any);

    expect(reasons.map((r) => r.code)).toEqual([
      "NO_QUANTITIES",
      "ORDERS_ALREADY_EXIST",
      "SALES_ORDER_WITHOUT_PART",
      "SALES_ORDER_WITHOUT_ORDER_DATA",
      "ORDER_DATA_WITHOUT_NUMBER",
      "PURCHASE_ORDER_IMAGE_REQUIRED",
      "SALES_ORDER_NOT_APPROVED",
      "SALES_ORDER_VOIDED",
      "ONE_ORDER_PER_SALES_ORDER",
    ]);
  });

  it("treats a voided pedido as a confirm, not a blocker, when force is set", () => {
    const voided = { voidedAt: new Date() };

    expect(
      evaluateGuards(guardInput(voided) as any).map((r) => r.code),
    ).toEqual(["SALES_ORDER_VOIDED"]);
    expect(
      evaluateGuards({ ...guardInput(voided), force: true } as any),
    ).toEqual([]);
  });

  it("carries Procusto's verbatim message on every guard", () => {
    const reasons = evaluateGuards({
      salesOrder: { ...approvedSalesOrder, partId: null },
      existingOrderCount: 1,
      promisedQuantities: [],
      force: false,
      config: {
        purchaseOrderImageRequired: false,
        oneOrderPerSalesOrder: false,
      },
    } as any);

    for (const r of reasons) {
      expect(r.message).toBe(GUARD_MESSAGES[r.code]);
    }
    expect(reasons.map((r) => r.message)).toContain(
      "El pedido ya tiene órdenes de producción asociadas",
    );
  });
});

describe("config catalogue (AC-26)", () => {
  it("resolves every key this feature reads, accents included", () => {
    for (const key of Object.values(PRODUCTION_ORDER_CONFIG_KEYS)) {
      expect(APP_CONFIG_DEFAULTS_BY_KEY.has(key)).toBe(true);
    }
  });

  it("ships the two keys the customer dump was missing", () => {
    expect(APP_CONFIG_DEFAULTS_BY_KEY.get("UnaOrdenPorPedido")).toEqual({
      key: "UnaOrdenPorPedido",
      valueType: "bool",
      defaultValue: "False",
    });
    expect(APP_CONFIG_DEFAULTS_BY_KEY.get("ImagenOCObligatoria")).toEqual({
      key: "ImagenOCObligatoria",
      valueType: "bool",
      defaultValue: "False",
    });
  });

  it("keeps the accented key verbatim (L-010)", () => {
    expect(PRODUCTION_ORDER_CONFIG_KEYS.allowNumberEdit).toBe(
      "PermitirModificaciónDeNumeroDeOrdenDeProducción",
    );
    expect(
      APP_CONFIG_DEFAULTS_BY_KEY.has(
        "PermitirModificaciónDeNumeroDeOrdenDeProducción",
      ),
    ).toBe(true);
  });
});

describe("GenerateOrdersInputDTO bounds the batch", () => {
  const rows = (count: number) =>
    Array.from({ length: count }, () => ({ quantity: 1, deliveryDate: null }));

  it("accepts a batch at the cap", () => {
    const dto = new GenerateOrdersInputDTO({
      salesOrderUuid: "pedido-uuid",
      promisedQuantities: rows(200),
    }).build();

    expect(dto.promisedQuantities).toHaveLength(200);
  });

  it("throws above the cap, so the controller answers 400", () => {
    // Unbounded, every row cost a `code_sequences` upsert on its own
    // connection plus an insert, all while the pedido row was held under
    // FOR UPDATE — the 100 kb body cap allowed a few thousand of them.
    expect(() =>
      new GenerateOrdersInputDTO({
        salesOrderUuid: "pedido-uuid",
        promisedQuantities: rows(201),
      }).build(),
    ).toThrow("promisedQuantities must not exceed 200 rows");
  });

  it("still lets an EMPTY batch through to guard G2", () => {
    const dto = new GenerateOrdersInputDTO({
      salesOrderUuid: "pedido-uuid",
      promisedQuantities: [],
    }).build();

    expect(dto.promisedQuantities).toEqual([]);
  });
});
