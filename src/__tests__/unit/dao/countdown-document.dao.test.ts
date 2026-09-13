// @ts-nocheck
/**
 * CountdownDocumentDAO — uploader and resolver names come from core
 * (db-per-company T2, D-132 revised; L-009).
 *
 * They are attribution on an existing record, so a deactivated user keeps their
 * name, while a user of another company is never printed on this company's
 * document.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { createTableAwareKnexMock } from "../../mocks/knex.mock";

let mock;
let mockKnex;

jest.mock("../../../database/registry", () => ({
  __esModule: true,
  db: () => mockKnex,
}));

let mockCoreUsers = [];
jest.mock("../../../services/core-client.service", () => ({
  ...jest.requireActual("../../../services/core-client.service"),
  CoreClient: {
    usersByIds: async (ids) =>
      mockCoreUsers.filter((user) => ids.includes(user.id)),
  },
}));

import { CountdownDocumentDAO } from "../../../dao/countdown/countdown-document.dao";

const COMPANY_ID = 7;
const TODAY = "2026-09-13";

const person = (id, overrides = {}) => ({
  id,
  uuid: `user-${id}`,
  email: `user${id}@example.com`,
  firstName: `First${id}`,
  lastName: `Last${id}`,
  isActive: true,
  companyId: COMPANY_ID,
  role: "member",
  ...overrides,
});

const documentRow = (overrides = {}) => ({
  id: 1,
  uuid: "doc-uuid",
  companyId: COMPANY_ID,
  title: "Seguro",
  issuer: null,
  referenceNumber: null,
  categoryUuid: null,
  categoryName: null,
  subcategoryUuid: null,
  subcategoryName: null,
  notes: null,
  amountCents: null,
  currency: null,
  dueDate: "2026-09-20",
  status: "resolved",
  recurrenceCount: null,
  recurrenceUnit: null,
  reminderDays: 7,
  overdue: false,
  daysUntilDue: 7,
  resolvedAt: "2026-09-12T10:00:00.000Z",
  uploadedBy: 10,
  resolvedBy: 11,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-12T10:00:00.000Z",
  ...overrides,
});

const findOne = async () => {
  mock.fixture("countdown_documents").firstRows = [documentRow()];
  const entry = await new CountdownDocumentDAO().findByUuid(
    "doc-uuid",
    COMPANY_ID,
    TODAY,
  );
  return entry.document;
};

beforeEach(() => {
  mock = createTableAwareKnexMock();
  mockKnex = mock.knexMock;
  mockCoreUsers = [];
});

describe("CountdownDocumentDAO — uploader and resolver names", () => {
  it("keeps the names of a deactivated uploader and resolver of the same company", async () => {
    mockCoreUsers = [
      person(10, { isActive: false }),
      person(11, { isActive: false }),
    ];

    const document = await findOne();

    expect(document.uploadedBy).toStrictEqual({
      uuid: "user-10",
      name: "First10 Last10",
    });
    expect(document.resolvedByName).toBe("First11 Last11");
  });

  it("never prints an uploader or resolver who belongs to another company", async () => {
    mockCoreUsers = [
      person(10, { companyId: 9 }),
      person(11, { companyId: 9 }),
    ];

    const document = await findOne();

    expect(document.uploadedBy).toBeNull();
    expect(document.resolvedByName).toBeNull();
  });
});
