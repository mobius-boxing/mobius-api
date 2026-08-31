// @ts-nocheck
/**
 * ProductionRouteDAO — stage-supply ordering (audit P1b, track T2a, AC-16).
 *
 * `production_route_stage_supplies.position` is NOT NULL as of migration
 * 20260831000001, so every insert-only path must populate it from array order:
 * `create()`, `clone()` and `copyStages()` all funnel through `insertStages`.
 * The reads that feed those paths must order by `position`, or a copy would
 * silently reshuffle the supplies it copies.
 *
 * Uses the shared table-aware, write-counting knex mock (brief D4) so writes
 * are attributed per table; T2 extends this file with the diff-and-upsert
 * assertions on `update()`.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { createTableAwareKnexMock } from "../../mocks/knex.mock";

let mock;
let mockKnex;

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: () => mockKnex,
}));

import { ProductionRouteDAO } from "../../../dao/production-route/production-route.dao";

const ROUTES = "production_routes";
const STAGES = "production_route_stages";
const MACHINES = "production_route_stage_machines";
const SUPPLIES = "production_route_stage_supplies";

const stageWithSupplies = (notes) => ({
  description: "Impresión",
  machineTypeId: 7,
  supplies: notes.map((note, i) => ({
    direction: i === 0 ? "input" : "output",
    supplyType: "paper",
    supplyId: 100 + i,
    notes: note,
  })),
});

beforeEach(() => {
  mock = createTableAwareKnexMock();
  mockKnex = mock.knexMock;
});

afterEach(() => jest.restoreAllMocks());

describe("ProductionRouteDAO — supply `position` is populated on every insert path (AC-16)", () => {
  it("create() numbers each stage's supplies 1..N by array order", async () => {
    mock.fixture(ROUTES).returningQueue = [[{ id: 10 }]];
    mock.fixture(STAGES).returningQueue = [[{ id: 21 }], [{ id: 22 }]];

    await new ProductionRouteDAO().create({
      companyId: 1,
      name: "R-1",
      stages: [
        stageWithSupplies(["a", "b", "c"]),
        stageWithSupplies(["d", "e"]),
      ],
    });

    const rows = mock.insertedRows(SUPPLIES);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => typeof r.position === "number")).toBe(true);
    expect(rows.map((r) => [r.stageId, r.position, r.notes])).toStrictEqual([
      [21, 1, "a"],
      [21, 2, "b"],
      [21, 3, "c"],
      [22, 1, "d"],
      [22, 2, "e"],
    ]);
  });

  it("copyStages() copies supplies in `position` order and renumbers them 1..N", async () => {
    mock.fixture(STAGES).rows = [
      { id: 5, number: 1, setupTimeMinutes: "3", machineTypeId: 7 },
    ];
    mock.fixture(STAGES).returningQueue = [[{ id: 99 }]];
    mock.fixture(MACHINES).rows = [];
    mock.fixture(SUPPLIES).rows = [
      { stageId: 5, direction: "input", supplyType: "paper", supplyId: 1 },
      { stageId: 5, direction: "output", supplyType: "sheet", supplyId: 2 },
    ];

    await new ProductionRouteDAO().copyStages(42, 5);

    // The source read must be ordered, or the copy reshuffles the supplies.
    expect(mock.orderByCalls(SUPPLIES)).toStrictEqual([["position", "asc"]]);
    expect(
      mock.insertedRows(SUPPLIES).map((r) => [r.stageId, r.position]),
    ).toStrictEqual([
      [99, 1],
      [99, 2],
    ]);
    // copyStages is an explicit "replace with a copy" verb: one stage DELETE,
    // and the supplies ride the cascade (no explicit child delete — L-006).
    expect(mock.writeCounts(STAGES).delete).toBe(1);
    expect(mock.writeCounts(SUPPLIES)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 0,
    });
  });

  it("clone() carries `position` through the copy of the source route", async () => {
    mock.fixture(ROUTES).firstRows = [
      { id: 5, companyId: 1, isGlobal: false, active: true },
    ];
    mock.fixture(ROUTES).returningQueue = [[{ id: 77 }]];
    mock.fixture(STAGES).rows = [
      { id: 5, number: 1, setupTimeMinutes: "0", machineTypeId: null },
    ];
    mock.fixture(STAGES).returningQueue = [[{ id: 88 }]];
    mock.fixture(MACHINES).rows = [];
    mock.fixture(SUPPLIES).rows = [
      { stageId: 5, direction: "input", supplyType: "paper", supplyId: 1 },
      {
        stageId: 5,
        direction: "input",
        supplyType: "consumable",
        supplyId: 3,
      },
      { stageId: 5, direction: "output", supplyType: "sheet", supplyId: 2 },
    ];

    await new ProductionRouteDAO().clone(5, "R-copy");

    expect(mock.insertedRows(SUPPLIES).map((r) => r.position)).toStrictEqual([
      1, 2, 3,
    ]);
  });
});

describe("ProductionRouteDAO — reads order supplies by `position` (T2a)", () => {
  it("getByUuid loads stage supplies ordered by position, not id", async () => {
    mock.fixture(ROUTES).firstRows = [{ id: 10, uuid: "route-uuid" }];
    mock.fixture(`${STAGES} as st`).rows = [
      { id: 21, uuid: "stage-uuid", number: 1, setupTimeMinutes: "0" },
    ];
    mock.fixture(`${MACHINES} as sm`).rows = [];
    mock.fixture(SUPPLIES).rows = [];

    await new ProductionRouteDAO().getByUuid("route-uuid");

    expect(mock.orderByCalls(SUPPLIES)).toStrictEqual([["position", "asc"]]);
  });
});

// ── update(): diff-and-upsert (T2) ──────────────────────────────────────────
// The DAO must stop rewriting the whole stage tree on every save. These tests
// count write statements per table through the shared mock's `writeLog`: the
// old delete-and-reinsert scores 1 DELETE + N INSERTs on all three tables, so
// every "zero writes" / "exactly one UPDATE" assertion below is red under it
// (mutation-checked, L-018).

import { ProductionRouteController } from "../../../controllers/production-route/production-route.controller";
import { ProductionRouteUpdateInputDTO } from "../../../dto/input/production-route";

const ROUTE_ROW = { id: 10, uuid: "route-uuid", companyId: 1 };
const NO_WRITES = { insert: 0, update: 0, delete: 0 };
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A stored stage. `setupTimeMinutes` is a string on purpose: float8 can come
 *  back from the driver as text, and an uncoerced compare would UPDATE forever. */
const stageRow = (over = {}) => ({
  id: 21,
  uuid: "st-1",
  routeId: 10,
  number: 1,
  description: "Impresión",
  isCorrugation: false,
  setupTimeMinutes: "5",
  machineTypeId: 7,
  legacyId: null,
  ...over,
});

/** A stage as `resolveStages` hands it to the DAO. */
const stageInput = (over = {}) => ({
  uuid: "st-1",
  number: 1,
  description: "Impresión",
  isCorrugation: false,
  setupTimeMinutes: 5,
  machineTypeId: 7,
  machines: [],
  supplies: [],
  ...over,
});

const supplyRow = (over = {}) => ({
  id: 301,
  uuid: "sup-1",
  stageId: 21,
  position: 1,
  direction: "input",
  supplyType: "paper",
  supplyId: 100,
  quantity: "2.5",
  quantityType: "kg",
  repetitionsWidth: 1,
  repetitionsLength: 1,
  allowsSimilar: false,
  notes: null,
  ...over,
});

const supplyInput = (over = {}) => ({
  uuid: "sup-1",
  direction: "input",
  supplyType: "paper",
  supplyId: 100,
  quantity: 2.5,
  quantityType: "kg",
  repetitionsWidth: 1.0,
  repetitionsLength: 1.0,
  allowsSimilar: false,
  notes: null,
  ...over,
});

const machineRow = (over = {}) => ({
  id: 401,
  stageId: 21,
  machineId: 55,
  isPrimary: true,
  ...over,
});

const givenStored = ({ stages = [], machines = [], supplies = [] }) => {
  mock.fixture(ROUTES).firstRows = [ROUTE_ROW];
  mock.fixture(STAGES).rows = stages;
  mock.fixture(MACHINES).rows = machines;
  mock.fixture(SUPPLIES).rows = supplies;
  // Ids for stage INSERTs. Unused when the diff inserts nothing — but it keeps
  // a delete-and-reinsert regression alive long enough to be judged on its
  // write counts instead of dying on a missing fixture (L-018).
  mock.fixture(STAGES).returningQueue = [
    [{ id: 91 }],
    [{ id: 92 }],
    [{ id: 93 }],
  ];
};

const putStages = (stages) => new ProductionRouteDAO().update(10, { stages });

/** Three stages, one machine and two supplies each. */
const storedTree = () => ({
  stages: [
    stageRow({ id: 21, uuid: "st-1", number: 1 }),
    stageRow({ id: 22, uuid: "st-2", number: 2, description: "Troquelado" }),
    stageRow({ id: 23, uuid: "st-3", number: 3, description: "Pegado" }),
  ],
  machines: [
    machineRow({ id: 401, stageId: 21, machineId: 55 }),
    machineRow({ id: 402, stageId: 22, machineId: 56 }),
    machineRow({ id: 403, stageId: 23, machineId: 57 }),
  ],
  supplies: [
    supplyRow({ id: 301, uuid: "sup-1", stageId: 21, position: 1 }),
    supplyRow({
      id: 302,
      uuid: "sup-2",
      stageId: 21,
      position: 2,
      direction: "output",
      supplyType: "sheet",
      supplyId: 200,
    }),
    supplyRow({ id: 303, uuid: "sup-3", stageId: 22, position: 1 }),
    supplyRow({ id: 304, uuid: "sup-4", stageId: 22, position: 2 }),
    supplyRow({ id: 305, uuid: "sup-5", stageId: 23, position: 1 }),
    supplyRow({ id: 306, uuid: "sup-6", stageId: 23, position: 2 }),
  ],
});

/** The same tree as the client sends it back, untouched. */
const incomingTree = () => [
  stageInput({
    uuid: "st-1",
    number: 1,
    machines: [{ machineId: 55, isPrimary: true }],
    supplies: [
      supplyInput({ uuid: "sup-1" }),
      supplyInput({
        uuid: "sup-2",
        direction: "output",
        supplyType: "sheet",
        supplyId: 200,
      }),
    ],
  }),
  stageInput({
    uuid: "st-2",
    number: 2,
    description: "Troquelado",
    machines: [{ machineId: 56, isPrimary: true }],
    supplies: [supplyInput({ uuid: "sup-3" }), supplyInput({ uuid: "sup-4" })],
  }),
  stageInput({
    uuid: "st-3",
    number: 3,
    description: "Pegado",
    machines: [{ machineId: 57, isPrimary: true }],
    supplies: [supplyInput({ uuid: "sup-5" }), supplyInput({ uuid: "sup-6" })],
  }),
];

describe("ProductionRouteDAO.update — identical payload writes nothing (AC-3)", () => {
  it("issues zero INSERT/UPDATE/DELETE on stages, machines and supplies", async () => {
    givenStored(storedTree());

    await putStages(incomingTree());

    expect(mock.writeCounts(STAGES)).toStrictEqual(NO_WRITES);
    expect(mock.writeCounts(MACHINES)).toStrictEqual(NO_WRITES);
    expect(mock.writeCounts(SUPPLIES)).toStrictEqual(NO_WRITES);
  });

  it("still writes nothing when the payload carries no uuids (ordinal fallback)", async () => {
    // The production state until the web app starts sending child uuids.
    givenStored(storedTree());
    const stripped = incomingTree().map((stage) => ({
      ...stage,
      uuid: undefined,
      supplies: stage.supplies.map((s) => ({ ...s, uuid: undefined })),
    }));

    await putStages(stripped);

    expect(mock.writeCounts(STAGES)).toStrictEqual(NO_WRITES);
    expect(mock.writeCounts(MACHINES)).toStrictEqual(NO_WRITES);
    expect(mock.writeCounts(SUPPLIES)).toStrictEqual(NO_WRITES);
  });
});

describe("ProductionRouteDAO.update — one edited field is one UPDATE (AC-4)", () => {
  it("updates only the changed column (plus updatedAt) on the one stage", async () => {
    givenStored(storedTree());
    const stages = incomingTree();
    stages[1].setupTimeMinutes = 12;

    await putStages(stages);

    expect(mock.writeCounts(STAGES)).toStrictEqual({
      insert: 0,
      update: 1,
      delete: 0,
    });
    expect(mock.writeCounts(MACHINES)).toStrictEqual(NO_WRITES);
    expect(mock.writeCounts(SUPPLIES)).toStrictEqual(NO_WRITES);
    // updatedAt only ever rides along with a real change — never on its own,
    // or every save manufactures an audit row.
    expect(mock.fixture(STAGES).updateCaptures).toStrictEqual([
      { setupTimeMinutes: 12, updatedAt: "NOW()" },
    ]);
    expect(mock.fixture(STAGES).whereCalls).toContainEqual(["id", 22]);
  });
});

describe("ProductionRouteDAO.update — removing a stage (AC-5)", () => {
  it("deletes the removed stage only; machines and supplies ride the cascade", async () => {
    givenStored(storedTree());
    const stages = incomingTree();
    stages.splice(1, 1); // drop the middle stage (st-2)

    await putStages(stages);

    expect(mock.writeCounts(STAGES).delete).toBe(1);
    expect(mock.writeCounts(STAGES).insert).toBe(0);
    expect(mock.fixture(STAGES).whereCalls).toContainEqual(["id", [22]]);
    // L-006: an explicit child DELETE here would double the ledger rows this
    // phase exists to shrink.
    expect(mock.writeCounts(MACHINES)).toStrictEqual(NO_WRITES);
    expect(mock.writeCounts(SUPPLIES)).toStrictEqual(NO_WRITES);
  });
});

describe("ProductionRouteDAO.update — reordering stages (AC-6)", () => {
  it("vacates the number range before renumbering, with no DELETE or INSERT", async () => {
    givenStored(storedTree());
    const [one, two, three] = incomingTree();

    await putStages([three, one, two]);

    expect(mock.writeCounts(STAGES)).toStrictEqual({
      insert: 0,
      update: 4, // one bulk vacate + one per mover
      delete: 0,
    });
    expect(mock.writeCounts(MACHINES)).toStrictEqual(NO_WRITES);
    expect(mock.writeCounts(SUPPLIES)).toStrictEqual(NO_WRITES);

    // UNIQUE("routeId","number") is non-deferrable: the global ordered log must
    // show the negation first, or the second renumber hits a 23505 in Postgres
    // (which no mock can see — hence the ordering assertion).
    const writes = mock.writeLog.filter((w) => w.table === STAGES);
    expect(writes.map((w) => w.op)).toStrictEqual([
      "update",
      "update",
      "update",
      "update",
    ]);
    expect(writes[0].data).toStrictEqual({ number: '-"number"' });
    expect(writes.slice(1).map((w) => w.data.number)).toStrictEqual([1, 2, 3]);
  });
});

describe("ProductionRouteDAO.update — reordering supplies inside a stage (AC-17)", () => {
  const oneStageWithThreeSupplies = () => ({
    stages: [stageRow({ id: 21, uuid: "st-1", number: 1 })],
    machines: [],
    supplies: [
      supplyRow({ id: 301, uuid: "sup-a", stageId: 21, position: 1 }),
      supplyRow({ id: 302, uuid: "sup-b", stageId: 21, position: 2 }),
      supplyRow({ id: 303, uuid: "sup-c", stageId: 21, position: 3 }),
    ],
  });

  it("issues only position UPDATEs — one vacate plus one per mover", async () => {
    givenStored(oneStageWithThreeSupplies());

    await putStages([
      stageInput({
        supplies: [
          supplyInput({ uuid: "sup-c" }),
          supplyInput({ uuid: "sup-a" }),
          supplyInput({ uuid: "sup-b" }),
        ],
      }),
    ]);

    expect(mock.writeCounts(SUPPLIES)).toStrictEqual({
      insert: 0,
      update: 4,
      delete: 0,
    });
    expect(mock.writeCounts(STAGES)).toStrictEqual(NO_WRITES);
    const writes = mock.writeLog.filter((w) => w.table === SUPPLIES);
    expect(writes[0].data).toStrictEqual({ position: '-"position"' });
    expect(writes.slice(1).map((w) => w.data)).toStrictEqual([
      { position: 1 },
      { position: 2 },
      { position: 3 },
    ]);
  });

  it("inserting a supply mid-list keeps every other supply's uuid", async () => {
    givenStored({
      stages: [stageRow({ id: 21, uuid: "st-1", number: 1 })],
      machines: [],
      supplies: [
        supplyRow({ id: 301, uuid: "sup-a", stageId: 21, position: 1 }),
        supplyRow({ id: 302, uuid: "sup-b", stageId: 21, position: 2 }),
      ],
    });

    await putStages([
      stageInput({
        supplies: [
          supplyInput({ uuid: "sup-a" }),
          supplyInput({ uuid: undefined, notes: "nueva" }),
          supplyInput({ uuid: "sup-b" }),
        ],
      }),
    ]);

    expect(mock.writeCounts(SUPPLIES)).toStrictEqual({
      insert: 1,
      update: 2, // vacate sup-b, then move it to position 3
      delete: 0,
    });
    // sup-a and sup-b keep their rows: no UPDATE touches `uuid`, and neither is
    // deleted and re-inserted.
    expect(
      mock
        .fixture(SUPPLIES)
        .updateCaptures.every((patch) => patch.uuid === undefined),
    ).toBe(true);
    const [inserted] = mock.insertedRows(SUPPLIES);
    expect(inserted.position).toBe(2);
    expect(inserted.notes).toBe("nueva");
    expect(inserted.uuid).toMatch(UUID_V4);
  });
});

describe("ProductionRouteDAO.update — client uuids are references, not values (AC-9)", () => {
  it("inserts an unknown incoming uuid as a new row with a server uuid", async () => {
    givenStored({
      stages: [stageRow({ id: 21, uuid: "st-1", number: 1 })],
      machines: [],
      supplies: [],
    });

    await putStages([
      stageInput({ uuid: "st-1" }),
      stageInput({ uuid: "b0gus-uuid-from-another-route", number: 2 }),
    ]);

    expect(mock.writeCounts(STAGES)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 0,
    });
    const [inserted] = mock.insertedRows(STAGES);
    expect(inserted.uuid).not.toBe("b0gus-uuid-from-another-route");
    expect(inserted.uuid).toMatch(UUID_V4);
    expect(inserted.number).toBe(2);
  });

  it("treats a duplicate incoming uuid the way delete+insert did: two rows", async () => {
    // Decided, not accidental: the first occurrence wins the match and the
    // second becomes a new row — exactly what the old delete-and-reinsert did
    // when a client sent the same stage twice. Do not "fix" this into a
    // dedupe; that would be a silent behaviour change.
    givenStored({
      stages: [stageRow({ id: 21, uuid: "st-1", number: 1 })],
      machines: [],
      supplies: [],
    });

    await putStages([
      stageInput({ uuid: "st-1" }),
      stageInput({ uuid: "st-1", number: 2 }),
    ]);

    expect(mock.writeCounts(STAGES)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 0,
    });
    const [inserted] = mock.insertedRows(STAGES);
    expect(inserted.uuid).toMatch(UUID_V4);
    expect(inserted.uuid).not.toBe("st-1");
    expect(inserted.number).toBe(2);
  });
});

describe("ProductionRouteDAO.update — stage machines are a keyed diff (AC-7)", () => {
  it("flipping isPrimary is one UPDATE, not a delete plus an insert", async () => {
    givenStored({
      stages: [stageRow({ id: 21, uuid: "st-1", number: 1 })],
      machines: [machineRow({ id: 401, stageId: 21, machineId: 55 })],
      supplies: [],
    });

    await putStages([
      stageInput({ machines: [{ machineId: 55, isPrimary: false }] }),
    ]);

    expect(mock.writeCounts(MACHINES)).toStrictEqual({
      insert: 0,
      update: 1,
      delete: 0,
    });
    expect(mock.fixture(MACHINES).updateCaptures).toStrictEqual([
      { isPrimary: false },
    ]);
    expect(mock.fixture(MACHINES).whereCalls).toContainEqual(["id", 401]);
  });

  it("swapping one machine for another is one bulk DELETE and one bulk INSERT", async () => {
    givenStored({
      stages: [stageRow({ id: 21, uuid: "st-1", number: 1 })],
      machines: [
        machineRow({ id: 401, stageId: 21, machineId: 55 }),
        machineRow({ id: 402, stageId: 21, machineId: 56, isPrimary: false }),
      ],
      supplies: [],
    });

    await putStages([
      stageInput({
        machines: [
          { machineId: 55, isPrimary: true },
          { machineId: 57, isPrimary: false },
        ],
      }),
    ]);

    expect(mock.writeCounts(MACHINES)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 1,
    });
    expect(mock.fixture(MACHINES).whereCalls).toContainEqual(["id", [402]]);
    expect(mock.insertedRows(MACHINES)).toStrictEqual([
      { stageId: 21, machineId: 57, isPrimary: false },
    ]);
  });
});

describe("child uuids survive the DTO and the controller mapper (T2)", () => {
  it("sanitizeStages keeps the stage and supply uuid (and drops non-strings)", () => {
    const dto = new ProductionRouteUpdateInputDTO({
      stages: [
        {
          uuid: "st-1",
          number: 1,
          supplies: [
            {
              uuid: "sup-1",
              direction: "input",
              supplyType: "paper",
              supplyUuid: "paper-uuid",
            },
          ],
        },
        { uuid: { not: "a string" }, number: 2 },
      ],
    }).build();

    expect(dto.stages[0].uuid).toBe("st-1");
    expect(dto.stages[0].supplies[0].uuid).toBe("sup-1");
    expect(dto.stages[1].uuid).toBeUndefined();
  });

  it("resolveStages carries the uuid onto the stage and supply it builds", async () => {
    // The uuid→id resolver is private by design (it writes its own 400s); this
    // reaches for it directly rather than standing up six collaborators to
    // assert one field, and it is exactly the mapper that silently degraded the
    // whole upsert to delete+insert when it dropped the uuid.
    mock.fixture("paper_supplies").firstRows = [{ id: 100 }];
    const req = { user: undefined, query: {} };
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };

    const resolved = await new ProductionRouteController()["resolveStages"](
      [
        {
          uuid: "st-1",
          number: 1,
          supplies: [
            {
              uuid: "sup-1",
              direction: "input",
              supplyType: "paper",
              supplyUuid: "paper-uuid",
            },
          ],
        },
      ],
      req,
      res,
    );

    expect(res.status).not.toHaveBeenCalled();
    expect(resolved[0].uuid).toBe("st-1");
    expect(resolved[0].supplies[0].uuid).toBe("sup-1");
  });
});
