/**
 * `POST /api/files` — which company does an uploaded file belong to? (AC-16, L-009)
 *
 * The whole point of the change: a superAdmin has `companyId: null` in their
 * JWT, so they could not upload a company's logo at all. They may now name a
 * target company — and ONLY they may. The dangerous row in this matrix is the
 * third one: a regular user who sends someone else's `companyId` must still get
 * their own company, silently, with no error that would tell them the field
 * exists.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { Request, Response, NextFunction } from "express";
import { createMockResponse, createMockNext } from "../../mocks/express.mock";

type AsyncStub = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

const mockFileDAO = {
  create: jest.fn() as AsyncStub,
  resolveCompanyId: jest.fn() as AsyncStub,
  resolveUserId: jest.fn() as AsyncStub,
};

jest.mock("../../../dao/file/file.dao", () => ({
  FileDAO: function FileDAO() {
    return {
      create: (...args: unknown[]) => mockFileDAO.create(...args),
      resolveCompanyId: (...args: unknown[]) =>
        mockFileDAO.resolveCompanyId(...args),
      resolveUserId: (...args: unknown[]) => mockFileDAO.resolveUserId(...args),
    };
  },
}));

jest.mock("../../../services/file-storage.service", () => ({
  FileStorageService: function FileStorageService() {
    return {
      buildStorageKey: (companyId: number, uuid: string, name: string) =>
        `companies/${companyId}/${uuid}-${name}`,
      putObject: async () => undefined,
      checksum: () => "checksum",
    };
  },
}));

import { FileController } from "../../../controllers/file/file.controller";

const OWN_COMPANY_UUID = "0b0e2a54-1d61-4a4c-8a3f-1b2c3d4e5f60";
const OTHER_COMPANY_UUID = "9c8b7a65-4321-4f0e-9d1c-2b3a4c5d6e7f";
const OWN_COMPANY_ID = 7;
const OTHER_COMPANY_ID = 42;

const uploadRequest = (
  user: { userId: string; role: string; companyId: string | null },
  body: Record<string, unknown> = {},
): Request =>
  ({
    params: {},
    query: {},
    headers: {},
    body,
    user,
    file: {
      originalname: "logo.png",
      mimetype: "image/png",
      size: 1024,
      buffer: Buffer.from("png"),
    },
  }) as unknown as Request;

const superAdmin = {
  userId: "11111111-1111-4111-8111-111111111111",
  role: "superAdmin",
  companyId: null,
};
const member = {
  userId: "22222222-2222-4222-8222-222222222222",
  role: "user",
  companyId: OWN_COMPANY_UUID,
};

describe("FileController.upload — target company scoping (AC-16)", () => {
  let controller: FileController;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    mockFileDAO.create.mockReset();
    mockFileDAO.resolveCompanyId.mockReset();
    mockFileDAO.resolveUserId.mockReset();
    mockFileDAO.resolveUserId.mockResolvedValue(1);
    mockFileDAO.create.mockImplementation(async (row: unknown) => row);
    // The uuid→id hop: whichever company uuid the controller decided on.
    mockFileDAO.resolveCompanyId.mockImplementation(async (uuid: unknown) =>
      uuid === OWN_COMPANY_UUID
        ? OWN_COMPANY_ID
        : uuid === OTHER_COMPANY_UUID
          ? OTHER_COMPANY_ID
          : null,
    );
    res = createMockResponse();
    next = createMockNext();
    controller = new FileController();
  });

  it("superAdmin + companyId ⇒ the file is created for that company", async () => {
    await controller.upload(
      uploadRequest(superAdmin, { companyId: OTHER_COMPANY_UUID }),
      res as Response,
      next,
    );

    expect(mockFileDAO.resolveCompanyId).toHaveBeenCalledWith(
      OTHER_COMPANY_UUID,
    );
    expect(mockFileDAO.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: OTHER_COMPANY_ID }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("superAdmin without companyId ⇒ 400 and nothing is written", async () => {
    await controller.upload(uploadRequest(superAdmin), res as Response, next);

    expect(mockFileDAO.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "SuperAdmin must specify a company",
    });
  });

  it("non-superAdmin sending ANOTHER company's companyId ⇒ their own company wins", async () => {
    await controller.upload(
      uploadRequest(member, { companyId: OTHER_COMPANY_UUID }),
      res as Response,
      next,
    );

    expect(mockFileDAO.resolveCompanyId).toHaveBeenCalledWith(OWN_COMPANY_UUID);
    expect(mockFileDAO.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: OWN_COMPANY_ID }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("non-superAdmin without any companyId ⇒ their JWT company", async () => {
    await controller.upload(uploadRequest(member), res as Response, next);

    expect(mockFileDAO.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: OWN_COMPANY_ID }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("a caller with no company at all ⇒ 400, nothing written", async () => {
    await controller.upload(
      uploadRequest({ ...member, companyId: null }),
      res as Response,
      next,
    );

    expect(mockFileDAO.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("an unknown target company ⇒ 404, nothing written", async () => {
    await controller.upload(
      uploadRequest(superAdmin, {
        companyId: "00000000-0000-4000-8000-000000000000",
      }),
      res as Response,
      next,
    );

    expect(mockFileDAO.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Company not found",
    });
  });

  it("no file part ⇒ 400 before any company resolution", async () => {
    const req = uploadRequest(superAdmin, { companyId: OTHER_COMPANY_UUID });
    delete (req as unknown as { file?: unknown }).file;

    await controller.upload(req, res as Response, next);

    expect(mockFileDAO.resolveCompanyId).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("the created row carries no client-supplied numeric id", async () => {
    await controller.upload(
      uploadRequest(superAdmin, {
        companyId: OTHER_COMPANY_UUID,
        id: 999,
      }),
      res as Response,
      next,
    );

    const created = mockFileDAO.create.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(created.id).toBeUndefined();
    expect(created.companyId).toBe(OTHER_COMPANY_ID);
  });
});
