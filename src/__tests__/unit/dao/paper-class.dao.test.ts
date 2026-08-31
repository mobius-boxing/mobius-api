// @ts-nocheck
/**
 * PaperClassDAO.replacePapers — set diff (audit P1b, track T3).
 *
 * `paper_class_papers` is nothing but its composite key `(paperClassId,
 * paperSupplyId)` — no `id`, no `uuid`, no `updatedAt` — so there is nothing to
 * update and the whole method is "insert what is new, delete what is gone".
 * Every save used to delete the class's entire paper list and reinsert it,
 * which is the churn P2's triggers would have recorded as the change.
 *
 * The uuid sanity filter and the uuid→id resolution have to run *before* the
 * diff, or a malformed uuid in the payload silently deletes a live link.
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

import { PaperClassDAO } from "../../../dao/paper-class/paper-class.dao";

const CLASSES = "paper_classes";
const LINKS = "paper_class_papers";
const SUPPLIES = "paper_supplies";
const PAPER_CLASS_ID = 5;

const uuidOne = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const uuidTwo = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * Stored links and the supplies the payload's uuids resolve to. `paperSupplyId`
 * is the only column the diff compares on either side.
 */
const givenStored = ({ links, resolves }) => {
  mock.fixture(CLASSES).returningQueue = [
    [{ id: PAPER_CLASS_ID, uuid: "class-uuid", code: "PC-1", name: "Kraft" }],
  ];
  mock.fixture(LINKS).rows = links.map((id) => ({ paperSupplyId: id }));
  mock.fixture(SUPPLIES).rows = resolves.map((id) => ({ id }));
};

const updatePapers = (papers) =>
  new PaperClassDAO().update(PAPER_CLASS_ID, { name: "Kraft", papers });

beforeEach(() => {
  mock = createTableAwareKnexMock();
  mockKnex = mock.knexMock;
});

afterEach(() => jest.restoreAllMocks());

describe("PaperClassDAO.replacePapers — set semantics (AC-3, AC-7)", () => {
  it("writes nothing when the payload resolves to the stored set", async () => {
    givenStored({ links: [11, 12], resolves: [11, 12] });

    await updatePapers([uuidOne, uuidTwo]);

    expect(mock.writeCounts(LINKS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 0,
    });
  });

  it("issues one bulk INSERT and no DELETE when a paper is added", async () => {
    givenStored({ links: [11], resolves: [11, 12] });

    await updatePapers([uuidOne, uuidTwo]);

    expect(mock.writeCounts(LINKS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 0,
    });
    expect(mock.insertedRows(LINKS)).toStrictEqual([
      { paperClassId: PAPER_CLASS_ID, paperSupplyId: 12 },
    ]);
  });

  it("issues one bulk DELETE and no INSERT when a paper is removed", async () => {
    givenStored({ links: [11, 12], resolves: [11] });

    await updatePapers([uuidOne]);

    expect(mock.writeCounts(LINKS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 1,
    });
    expect(mock.fixture(LINKS).whereCalls).toContainEqual([
      "paperSupplyId",
      [12],
    ]);
  });

  it("issues exactly one INSERT and one DELETE when one is swapped for another", async () => {
    givenStored({ links: [11], resolves: [12] });

    await updatePapers([uuidTwo]);

    expect(mock.writeCounts(LINKS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 1,
    });
    expect(mock.insertedRows(LINKS)).toStrictEqual([
      { paperClassId: PAPER_CLASS_ID, paperSupplyId: 12 },
    ]);
    expect(mock.fixture(LINKS).whereCalls).toContainEqual([
      "paperSupplyId",
      [11],
    ]);
  });

  it("clears the list with a single DELETE when the payload is empty", async () => {
    givenStored({ links: [11, 12], resolves: [] });

    await updatePapers([]);

    expect(mock.writeCounts(LINKS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 1,
    });
    // Nothing to resolve, so paper_supplies is never queried.
    expect(mock.fixture(SUPPLIES).whereCalls).toStrictEqual([]);
  });
});

describe("PaperClassDAO.replacePapers — malformed uuids never reach the diff", () => {
  it("drops a malformed uuid before resolving, leaving the real link untouched", async () => {
    givenStored({ links: [11], resolves: [11] });

    await updatePapers(["not-a-uuid", uuidOne]);

    // The uuid-typed column would throw on the junk value, and diffing raw
    // uuids against resolved ids would delete link 11 and reinsert it.
    expect(mock.fixture(SUPPLIES).whereCalls).toStrictEqual([
      ["uuid", [uuidOne]],
    ]);
    expect(mock.writeCounts(LINKS)).toStrictEqual({
      insert: 0,
      update: 0,
      delete: 0,
    });
  });
});

describe("PaperClassDAO.create — the insert-only path still links papers", () => {
  it("inserts the resolved links and deletes nothing on a brand-new class", async () => {
    mock.fixture(CLASSES).returningQueue = [
      [{ id: PAPER_CLASS_ID, uuid: "class-uuid", code: "PC-1", name: "Kraft" }],
    ];
    mock.fixture(LINKS).rows = [];
    mock.fixture(SUPPLIES).rows = [{ id: 11 }, { id: 12 }];

    await new PaperClassDAO().create({
      uuid: "class-uuid",
      companyId: 1,
      code: "PC-1",
      name: "Kraft",
      papers: [uuidOne, uuidTwo],
    });

    expect(mock.writeCounts(LINKS)).toStrictEqual({
      insert: 1,
      update: 0,
      delete: 0,
    });
    expect(mock.insertedRows(LINKS)).toStrictEqual([
      { paperClassId: PAPER_CLASS_ID, paperSupplyId: 11 },
      { paperClassId: PAPER_CLASS_ID, paperSupplyId: 12 },
    ]);
  });
});
