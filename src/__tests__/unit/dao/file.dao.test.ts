import { describe, it, expect, beforeEach, jest } from "@jest/globals";

const mockWithTenant =
  jest.fn<(companyId: number, fn: () => Promise<unknown>) => Promise<unknown>>();

jest.mock("../../../database/registry", () => ({
  db: () => {
    throw new Error("unit tests never reach the database");
  },
  withTenant: (companyId: number, fn: () => Promise<unknown>) =>
    mockWithTenant(companyId, fn),
}));
jest.mock("../../../database/tenant-pools", () => ({
  TenantUnavailableError: class TenantUnavailableError extends Error {},
}));

import { FileDAO } from "../../../dao/file/file.dao";
import { TenantUnavailableError } from "../../../database/tenant-pools";
import type { IFile } from "../../../interfaces/file/file.interfaces";

const LOGO_UUID = "3f1a7c1e-4b2d-4a6e-9c1f-2b7d8e5a1c40";
const fileRow = (storageKey: string): IFile =>
  ({ uuid: LOGO_UUID, storageKey }) as unknown as IFile;

describe("FileDAO.getLogoFile", () => {
  let dao: FileDAO;

  beforeEach(() => {
    dao = new FileDAO();
    mockWithTenant.mockReset();
    mockWithTenant.mockImplementation((_companyId, fn) => fn());
  });

  it("returns the central logo row without opening the company's database", async () => {
    const central = jest
      .spyOn(dao, "getCentralByUuid")
      .mockResolvedValue(fileRow("companies/7/logo.png"));
    const tenant = jest.spyOn(dao, "getByUuid");

    await expect(dao.getLogoFile(LOGO_UUID, 7)).resolves.toEqual(
      fileRow("companies/7/logo.png"),
    );
    expect(central).toHaveBeenCalledWith(LOGO_UUID, 7);
    expect(mockWithTenant).not.toHaveBeenCalled();
    expect(tenant).not.toHaveBeenCalled();
  });

  it("reads the company's own database, inside its tenant scope, when the central row is missing", async () => {
    jest.spyOn(dao, "getCentralByUuid").mockResolvedValue(null);
    const tenant = jest
      .spyOn(dao, "getByUuid")
      .mockResolvedValue(fileRow("companies/7/new-logo.png"));

    await expect(dao.getLogoFile(LOGO_UUID, 7)).resolves.toEqual(
      fileRow("companies/7/new-logo.png"),
    );
    expect(mockWithTenant).toHaveBeenCalledWith(7, expect.any(Function));
    expect(tenant).toHaveBeenCalledWith(LOGO_UUID, 7);
  });

  it("answers null when the company's database is unavailable", async () => {
    jest.spyOn(dao, "getCentralByUuid").mockResolvedValue(null);
    const Unavailable = TenantUnavailableError as unknown as new (
      message: string,
    ) => Error;
    mockWithTenant.mockRejectedValue(new Unavailable("tenant down"));

    await expect(dao.getLogoFile(LOGO_UUID, 7)).resolves.toBeNull();
  });

  it("rethrows any other failure", async () => {
    jest.spyOn(dao, "getCentralByUuid").mockResolvedValue(null);
    mockWithTenant.mockRejectedValue(new Error("connection reset"));

    await expect(dao.getLogoFile(LOGO_UUID, 7)).rejects.toThrow(
      "connection reset",
    );
  });
});
