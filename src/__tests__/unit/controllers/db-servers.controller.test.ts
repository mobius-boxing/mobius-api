/**
 * `GET/POST /api/db-servers`, `PATCH /api/db-servers/:uuid` (db-per-company
 * T10, model). Pinned: the list item never carries `adminUser`/
 * `adminCredentialRef`/`adminCredentialCiphertext`/`host` beyond what the
 * model documents (AC-58/AC-61); `create` maps `DbServerNameTakenError`/
 * `DbServerDefaultPlacementExistsError` to their exact codes; `PATCH` only
 * ever accepts `{status:"draining"}` (AC-61).
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { Request, Response, NextFunction } from "express";
import {
  createMockResponse,
  createMockNext,
  createMockRequest,
} from "../../mocks/express.mock";

type AsyncStub = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

const mockDbServerDAO = {
  getAllWithFilters: jest.fn() as AsyncStub,
  create: jest.fn() as AsyncStub,
  getByUuid: jest.fn() as AsyncStub,
  updateStatus: jest.fn() as AsyncStub,
};

jest.mock("../../../dao/db-server/db-server.dao", () => {
  const actual = jest.requireActual(
    "../../../dao/db-server/db-server.dao",
  ) as any;
  return {
    ...actual,
    DbServerDAO: function DbServerDAO() {
      return {
        getAllWithFilters: (...args: unknown[]) =>
          mockDbServerDAO.getAllWithFilters(...args),
        create: (...args: unknown[]) => mockDbServerDAO.create(...args),
        getByUuid: (...args: unknown[]) => mockDbServerDAO.getByUuid(...args),
        updateStatus: (...args: unknown[]) =>
          mockDbServerDAO.updateStatus(...args),
      };
    },
  };
});
jest.mock("uuid", () => ({ v4: () => "generated-server-uuid" }));

import { DbServersController } from "../../../controllers/db-servers/db-servers.controller";
import {
  DbServerDefaultPlacementExistsError,
  DbServerNameTakenError,
} from "../../../dao/db-server/db-server.dao";

const reqFor = (overrides: Partial<Request> = {}): Request =>
  createMockRequest(overrides) as Request;

const SERVER_ROW: any = {
  id: 2,
  uuid: "0e7a1c3d-1111-4e6f-9b1d-3e5f7a9c1e2b",
  name: "acme-rds-1",
  kind: "rds",
  host: "acme-1.example.com",
  port: 5432,
  sslMode: "verify-full",
  status: "active",
  isDefaultPlacement: false,
  connectionBudget: 20,
  adminUser: "mobius_admin",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("DbServersController", () => {
  let controller: DbServersController;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    mockDbServerDAO.getAllWithFilters.mockReset();
    mockDbServerDAO.create.mockReset();
    mockDbServerDAO.getByUuid.mockReset();
    mockDbServerDAO.updateStatus.mockReset();
    res = createMockResponse();
    next = createMockNext();
    controller = new DbServersController();
  });

  describe("getAll (AC-61)", () => {
    it("returns an unwrapped paginator with provisionable/tenantCount on each item", async () => {
      mockDbServerDAO.getAllWithFilters.mockResolvedValue({
        success: true,
        data: [{ ...SERVER_ROW, tenantCount: 3, provisionable: true }],
        page: 1,
        limit: 20,
        count: 1,
        totalCount: 1,
        totalPages: 1,
      });

      await controller.getAll(reqFor({ query: {} }), res as Response, next);

      expect(res.status).toHaveBeenCalledWith(200);
      const body: any = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.totalCount).toBe(1);
      expect(body.data[0]).toMatchObject({
        uuid: SERVER_ROW.uuid,
        tenantCount: 3,
        provisionable: true,
      });
      expect(body.data[0].adminUser).toBeUndefined();
      expect(body.data[0].adminCredentialRef).toBeUndefined();
    });
  });

  describe("create (AC-61)", () => {
    it("creates and returns 201 with the list-item shape", async () => {
      mockDbServerDAO.create.mockResolvedValue(SERVER_ROW);

      await controller.create(
        reqFor({
          body: {
            name: "acme-rds-1",
            kind: "rds",
            host: "acme-1.example.com",
            connectionBudget: 20,
          },
        }),
        res as Response,
        next,
      );

      expect(mockDbServerDAO.create).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: "generated-server-uuid",
          name: "acme-rds-1",
          kind: "rds",
          host: "acme-1.example.com",
          connectionBudget: 20,
        }),
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("400s a validation failure (missing connectionBudget) without calling the DAO", async () => {
      await controller.create(
        reqFor({ body: { name: "x", kind: "rds", host: "h" } }),
        res as Response,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(mockDbServerDAO.create).not.toHaveBeenCalled();
    });

    it("409s NAME_TAKEN", async () => {
      mockDbServerDAO.create.mockRejectedValue(
        new DbServerNameTakenError("acme-rds-1"),
      );

      await controller.create(
        reqFor({
          body: {
            name: "acme-rds-1",
            kind: "rds",
            host: "h",
            connectionBudget: 20,
          },
        }),
        res as Response,
        next,
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "NAME_TAKEN" }),
      );
    });

    it("409s DEFAULT_PLACEMENT_EXISTS", async () => {
      mockDbServerDAO.create.mockRejectedValue(
        new DbServerDefaultPlacementExistsError(),
      );

      await controller.create(
        reqFor({
          body: {
            name: "acme-rds-2",
            kind: "rds",
            host: "h",
            connectionBudget: 20,
            isDefaultPlacement: true,
          },
        }),
        res as Response,
        next,
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "DEFAULT_PLACEMENT_EXISTS" }),
      );
    });
  });

  describe("updateStatus (AC-61)", () => {
    it("200s {status:'draining'}", async () => {
      mockDbServerDAO.getByUuid.mockResolvedValue(SERVER_ROW);
      mockDbServerDAO.updateStatus.mockResolvedValue({
        ...SERVER_ROW,
        status: "draining",
      });

      await controller.updateStatus(
        reqFor({
          params: { uuid: SERVER_ROW.uuid },
          body: { status: "draining" },
        }),
        res as Response,
        next,
      );

      expect(mockDbServerDAO.updateStatus).toHaveBeenCalledWith(
        SERVER_ROW.uuid,
        "draining",
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("400s any other body", async () => {
      for (const body of [{ status: "active" }, {}, { status: "retired" }]) {
        const localNext = createMockNext();
        await controller.updateStatus(
          reqFor({ params: { uuid: SERVER_ROW.uuid }, body }),
          res as Response,
          localNext,
        );
        expect(localNext).toHaveBeenCalledWith(expect.any(Error));
      }
      expect(mockDbServerDAO.updateStatus).not.toHaveBeenCalled();
    });

    it("404s an unknown server", async () => {
      mockDbServerDAO.getByUuid.mockResolvedValue(null);

      await controller.updateStatus(
        reqFor({
          params: { uuid: SERVER_ROW.uuid },
          body: { status: "draining" },
        }),
        res as Response,
        next,
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockDbServerDAO.updateStatus).not.toHaveBeenCalled();
    });
  });
});
