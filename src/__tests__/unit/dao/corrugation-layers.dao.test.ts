// @ts-nocheck
/**
 * CorrugationDAO.replaceLayers — diff-and-upsert (audit P1b, track T3).
 *
 * A Capas save used to DELETE the whole stack and re-INSERT it, so every layer
 * got a new `uuid` and a new numeric id on every save and P2's row triggers
 * would record a full rewrite instead of the one field the user touched. These
 * cases pin the new behaviour: an identical payload writes nothing, a reorder
 * is `position` UPDATEs only, and the statement order that keeps the
 * non-deferrable `UNIQUE("corrugationId","position")` from raising `23505`.
 *
 * Separate file on purpose: `corrugation.dao.test.ts` is built on the older
 * shared-builder mock, and mixing two mock styles in one file is worse than
 * two files (brief D4). This one uses the table-aware, write-counting mock.
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

import { CorrugationDAO } from "../../../dao/corrugation/corrugation.dao";
import { CorrugationController } from "../../../controllers/corrugation/corrugation.controller";
import { CorrugationUpdateInputDTO } from "../../../dto/input/corrugation";

const LAYERS = "corrugation_layers";
const CORRUGATION_ID = 42;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const uuidA = "11111111-1111-4111-8111-111111111111";
const uuidB = "22222222-2222-4222-8222-222222222222";
const uuidC = "33333333-3333-4333-8333-333333333333";
const uuidUnknown = "99999999-9999-4999-8999-999999999999";

/** A row as `corrugation_layers` stores it. */
const storedLayer = (id, uuid, position, overrides = {}) => ({
  id,
  uuid,
  position,
  isLiner: false,
  paperClassId: 7,
  fluteTypeId: 8,
  corrugationId: CORRUGATION_ID,
  legacyId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

/** The same row as the controller hands it to the DAO (no id, no timestamps). */
const incomingLayer = (uuid, overrides = {}) => ({
  uuid,
  position: 0, // ignored: the DAO derives position from array order
  isLiner: false,
  paperClassId: 7,
  fluteTypeId: 8,
  ...overrides,
});

/** The three stored layers most cases start from, in `position` order. */
const threeStoredLayers = () => [
  storedLayer(101, uuidA, 1),
  storedLayer(102, uuidB, 2),
  storedLayer(103, uuidC, 3),
];

const layerWrites = () =>
  mock.writeLog.filter((entry) => entry.table === LAYERS);

beforeEach(() => {
  mock = createTableAwareKnexMock();
  mockKnex = mock.knexMock;
});

afterEach(() => jest.restoreAllMocks());

describe("CorrugationDAO.replaceLayers — unchanged payloads write nothing (AC-3)", () => {
  it("issues zero statements when every layer is identical", async () => {
    mock.fixture(LAYERS).rows = threeStoredLayers();

    await new CorrugationDAO().replaceLayers(CORRUGATION_ID, [
      incomingLayer(uuidA),
      incomingLayer(uuidB),
      incomingLayer(uuidC),
    ]);

    expect(mock.writeCounts(LAYERS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 0,
    });
  });

  it("issues zero statements for a uuid-less payload via the ordinal fallback", async () => {
    // The state production lives in until the web app sends layer uuids.
    mock.fixture(LAYERS).rows = threeStoredLayers();

    await new CorrugationDAO().replaceLayers(CORRUGATION_ID, [
      incomingLayer(undefined),
      incomingLayer(undefined),
      incomingLayer(undefined),
    ]);

    expect(mock.writeCounts(LAYERS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 0,
    });
  });

  it("reads the stored stack in position order so the fallback pairs correctly", async () => {
    mock.fixture(LAYERS).rows = threeStoredLayers();

    await new CorrugationDAO().replaceLayers(CORRUGATION_ID, []);

    expect(mock.orderByCalls(LAYERS)).toStrictEqual([["position", "asc"]]);
  });
});

describe("CorrugationDAO.replaceLayers — edits touch only what changed", () => {
  it("changing one layer's field issues exactly one UPDATE, no DELETE, no INSERT", async () => {
    mock.fixture(LAYERS).rows = threeStoredLayers();

    await new CorrugationDAO().replaceLayers(CORRUGATION_ID, [
      incomingLayer(uuidA),
      incomingLayer(uuidB, { isLiner: true }),
      incomingLayer(uuidC),
    ]);

    expect(mock.writeCounts(LAYERS)).toStrictEqual({
      insert: 0,
      update: 1,
      delete: 0,
    });
    // updatedAt rides along with a real change — never on its own.
    expect(mock.fixture(LAYERS).updateCaptures).toStrictEqual([
      { isLiner: true, updatedAt: "NOW()" },
    ]);
  });

  it("removing a layer DELETEs it by id and renumbers the survivors", async () => {
    mock.fixture(LAYERS).rows = threeStoredLayers();

    await new CorrugationDAO().replaceLayers(CORRUGATION_ID, [
      incomingLayer(uuidA),
      incomingLayer(uuidC),
    ]);

    expect(mock.writeCounts(LAYERS)).toStrictEqual({
      insert: 0,
      update: 2, // one bulk vacate + the one survivor that moved (3 → 2)
      delete: 1,
    });
    // The DELETE runs first: it frees the ordinal the survivor moves into.
    expect(layerWrites().map((entry) => entry.op)).toStrictEqual([
      "delete",
      "update",
      "update",
    ]);
    expect(mock.fixture(LAYERS).whereCalls).toContainEqual(["id", [102]]);
  });

  it("clearing the stack DELETEs every row and inserts nothing", async () => {
    mock.fixture(LAYERS).rows = threeStoredLayers();

    await new CorrugationDAO().replaceLayers(CORRUGATION_ID, []);

    expect(mock.writeCounts(LAYERS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 1,
    });
    expect(mock.fixture(LAYERS).whereCalls).toContainEqual([
      "id",
      [101, 102, 103],
    ]);
  });
});

describe("CorrugationDAO.replaceLayers — reordering is UPDATEs only (AC-6)", () => {
  it("vacates the position range before renumbering, and never deletes or inserts", async () => {
    mock.fixture(LAYERS).rows = threeStoredLayers();

    // C, A, B — every layer moves.
    await new CorrugationDAO().replaceLayers(CORRUGATION_ID, [
      incomingLayer(uuidC),
      incomingLayer(uuidA),
      incomingLayer(uuidB),
    ]);

    expect(mock.writeCounts(LAYERS)).toStrictEqual({
      insert: 0,
      update: 4, // one bulk vacate + one per mover
      delete: 0,
    });

    // Order matters: UNIQUE("corrugationId","position") is non-deferrable, so
    // renumbering in place without vacating the range first raises 23505.
    const updates = layerWrites().filter((entry) => entry.op === "update");
    expect(updates[0].data).toStrictEqual({ position: '-"position"' });
    expect(updates.slice(1).map((entry) => entry.data.position)).toStrictEqual([
      1, 2, 3,
    ]);
    expect(mock.fixture(LAYERS).whereCalls).toContainEqual([
      "id",
      [103, 101, 102],
    ]);
  });

  it("does not vacate when no layer changes position", async () => {
    mock.fixture(LAYERS).rows = threeStoredLayers();

    await new CorrugationDAO().replaceLayers(CORRUGATION_ID, [
      incomingLayer(uuidA, { fluteTypeId: 9 }),
      incomingLayer(uuidB),
      incomingLayer(uuidC),
    ]);

    const updates = layerWrites().filter((entry) => entry.op === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].data).toStrictEqual({
      fluteTypeId: 9,
      updatedAt: "NOW()",
    });
  });
});

describe("CorrugationDAO.replaceLayers — client uuids are references, not values (AC-9)", () => {
  it("INSERTs a fresh server uuid for an incoming uuid nothing stored claims", async () => {
    mock.fixture(LAYERS).rows = [storedLayer(101, uuidA, 1)];

    await new CorrugationDAO().replaceLayers(CORRUGATION_ID, [
      incomingLayer(uuidA),
      incomingLayer(uuidUnknown, { isLiner: true }),
    ]);

    expect(mock.writeCounts(LAYERS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 0,
    });
    const [inserted] = mock.insertedRows(LAYERS);
    expect(inserted.uuid).not.toBe(uuidUnknown);
    expect(inserted.uuid).toMatch(UUID_V4);
    expect(inserted).toMatchObject({
      corrugationId: CORRUGATION_ID,
      position: 2,
      isLiner: true,
      paperClassId: 7,
      fluteTypeId: 8,
    });
  });
});

describe("Corrugation layer uuid survives the DTO and the controller", () => {
  it("carries a layer uuid from request body to a zero-write DAO save", async () => {
    const body = {
      code: "C-1",
      layers: [
        { uuid: uuidA, position: 1, isLiner: false },
        { uuid: uuidB, position: 2, isLiner: false },
      ],
    };

    const dto = new CorrugationUpdateInputDTO(body).build();
    expect(dto.layers.map((layer) => layer.uuid)).toStrictEqual([uuidA, uuidB]);

    // beforeUpdate owns the controller's layer mapper (resolveLayers).
    const res = { status: jest.fn(() => res), json: jest.fn() };
    const updateData = await new CorrugationController().beforeUpdate(
      dto,
      CORRUGATION_ID,
      {},
      res,
    );
    expect(res.status).not.toHaveBeenCalled();
    expect(updateData.layers.map((layer) => layer.uuid)).toStrictEqual([
      uuidA,
      uuidB,
    ]);

    // End to end: what the controller produced must diff clean against the
    // rows it came from. Without the uuid this is two DELETEs and two INSERTs.
    mock.fixture(LAYERS).rows = [
      storedLayer(101, uuidA, 1, { paperClassId: null, fluteTypeId: null }),
      storedLayer(102, uuidB, 2, { paperClassId: null, fluteTypeId: null }),
    ];
    await new CorrugationDAO().replaceLayers(CORRUGATION_ID, updateData.layers);

    expect(mock.writeCounts(LAYERS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 0,
    });
  });
});
