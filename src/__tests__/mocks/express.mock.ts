// @ts-nocheck
/**
 * Express Request/Response Mocks
 * For unit testing controllers
 */

import { jest } from "@jest/globals";
import { Request, Response, NextFunction } from "express";

/**
 * Create mock Express Request
 */
export const createMockRequest = (
  overrides: Partial<Request> = {},
): Partial<Request> => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  get: jest.fn().mockReturnValue(""),
  ...overrides,
});

/**
 * Create mock Express Response
 */
export const createMockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis() as any,
    json: jest.fn().mockReturnThis() as any,
    send: jest.fn().mockReturnThis() as any,
    end: jest.fn().mockReturnThis() as any,
    set: jest.fn().mockReturnThis() as any,
    cookie: jest.fn().mockReturnThis() as any,
    clearCookie: jest.fn().mockReturnThis() as any,
    redirect: jest.fn().mockReturnThis() as any,
  };
  return res;
};

/**
 * Create mock NextFunction
 */
export const createMockNext = (): NextFunction => jest.fn() as NextFunction;

/**
 * Create authenticated request with user
 */
export const createAuthenticatedRequest = (
  user: any,
  overrides: Partial<Request> = {},
): Partial<Request> => ({
  ...createMockRequest(overrides),
  user,
  headers: {
    authorization: "Bearer test-token",
    ...overrides.headers,
  },
});

/**
 * Create request with pagination
 */
export const createPaginatedRequest = (
  page = 1,
  limit = 10,
  overrides: Partial<Request> = {},
): Partial<Request> =>
  createMockRequest({
    query: { page: String(page), limit: String(limit) },
    ...overrides,
  });

/**
 * Create request with UUID param
 */
export const createUuidParamRequest = (
  uuid: string,
  overrides: Partial<Request> = {},
): Partial<Request> =>
  createMockRequest({
    params: { uuid },
    ...overrides,
  });

/**
 * Create request with body
 */
export const createBodyRequest = (
  body: any,
  overrides: Partial<Request> = {},
): Partial<Request> =>
  createMockRequest({
    body,
    ...overrides,
  });

/**
 * Helper to assert response
 */
export const expectJsonResponse = (
  res: Partial<Response>,
  statusCode: number,
  expectedData: any,
) => {
  expect(res.status).toHaveBeenCalledWith(statusCode);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining(expectedData));
};

/**
 * Helper to assert error was passed to next
 */
export const expectNextCalledWithError = (
  next: NextFunction,
  errorMessage?: string,
) => {
  expect(next).toHaveBeenCalled();
  if (errorMessage) {
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(errorMessage),
      }),
    );
  }
};
