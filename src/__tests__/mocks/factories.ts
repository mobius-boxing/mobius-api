/**
 * Test Data Factories
 * Generate consistent test data for all entities
 */

import { v4 as uuidv4 } from "uuid";

// Base factory utilities
const now = () => new Date().toISOString();
let idCounter = 1;
const nextId = () => idCounter++;

// Reset counter between test suites
export const resetIdCounter = () => {
  idCounter = 1;
};

/**
 * User Factory
 */
export const createTestUser = (overrides: any = {}) => ({
  id: nextId(),
  uuid: uuidv4(),
  email: `testuser${idCounter}@example.com`,
  firstName: "Test",
  lastName: "User",
  password: "$2a$10$hashedpassword",
  role: "member" as const,
  companyId: 1,
  isActive: true,
  emailVerified: true,
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
});

export const createTestUserResponse = (overrides: any = {}) => {
  const user = createTestUser(overrides);
  const { password, id, companyId, ...response } = user;
  return response;
};

/**
 * Company Factory
 */
export const createTestCompany = (overrides: any = {}) => ({
  id: nextId(),
  uuid: uuidv4(),
  name: `Test Company ${idCounter}`,
  description: "A test company",
  isActive: true,
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
});

export const createTestCompanyResponse = (overrides: any = {}) => {
  const company = createTestCompany(overrides);
  const { id, ...response } = company;
  return response;
};

/**
 * Corrugation Class Factory
 */
export const createTestCorrugationClass = (overrides: any = {}) => ({
  id: nextId(),
  uuid: uuidv4(),
  code: `CC${String(idCounter).padStart(3, "0")}`,
  description: "Test corrugation class",
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
});

export const createTestCorrugationClassResponse = (overrides: any = {}) => {
  const cc = createTestCorrugationClass(overrides);
  const { id, ...response } = cc;
  return response;
};

/**
 * Corrugation Factory
 */
export const createTestCorrugation = (overrides: any = {}) => ({
  id: nextId(),
  uuid: uuidv4(),
  code: `CRG${String(idCounter).padStart(3, "0")}`,
  description: "Test corrugation",
  theoreticalGrammage: 150.5,
  suggestedWidth: 1200,
  caliper: 0.35,
  corrugationClassId: 1,
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
});

export const createTestCorrugationResponse = (overrides: any = {}) => {
  const corrugation = createTestCorrugation(overrides);
  const { id, corrugationClassId, ...response } = corrugation;
  return {
    ...response,
    corrugationClass:
      overrides.corrugationClass || createTestCorrugationClassResponse(),
  };
};

/**
 * Customer Category Factory
 */
export const createTestCustomerCategory = (overrides: any = {}) => ({
  id: nextId(),
  uuid: uuidv4(),
  name: `Category ${idCounter}`,
  companyId: 1,
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
});

/**
 * Customer Factory
 */
export const createTestCustomer = (overrides: any = {}) => ({
  id: nextId(),
  uuid: uuidv4(),
  companyId: 1,
  name: `Test Customer ${idCounter}`,
  supplierCode: `SUP${String(idCounter).padStart(3, "0")}`,
  salesPersonId: null,
  categoryId: null,
  active: true,
  legalName: "Test Customer Legal Name",
  legalCode: "TC123456",
  address: "123 Test Street",
  tradeName: "Test Customer Trade",
  contacts: [],
  deliveryLocations: [],
  deliveryDays: [],
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
});

/**
 * Product Factory
 */
export const createTestProduct = (overrides: any = {}) => ({
  id: nextId(),
  uuid: uuidv4(),
  code: `PROD${String(idCounter).padStart(3, "0")}`,
  clientCode: `CLI${String(idCounter).padStart(3, "0")}`,
  description: "Test product description",
  customerId: 1,
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
});

/**
 * Warehouse Factory
 */
export const createTestWarehouse = (overrides: any = {}) => ({
  id: nextId(),
  uuid: uuidv4(),
  name: `Warehouse ${idCounter}`,
  gridRows: 10,
  gridCols: 20,
  companyId: 1,
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
});

/**
 * Paper Type Factory
 */
export const createTestPaperType = (overrides: any = {}) => ({
  id: nextId(),
  uuid: uuidv4(),
  code: `PT${String(idCounter).padStart(3, "0")}`,
  description: "Test paper type",
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
});

/**
 * Flute Type Factory
 */
export const createTestFluteType = (overrides: any = {}) => ({
  id: nextId(),
  uuid: uuidv4(),
  code: `FT${String(idCounter).padStart(3, "0")}`,
  description: "Test flute type",
  fluteFactor: 1.5,
  length: 100,
  width: 50,
  height: 25,
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
});

/**
 * Paper Class Factory
 */
export const createTestPaperClass = (overrides: any = {}) => ({
  id: nextId(),
  uuid: uuidv4(),
  code: `PC${String(idCounter).padStart(3, "0")}`,
  name: `Paper Class ${idCounter}`,
  papers: [],
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
});

/**
 * Manufacturer Factory
 */
export const createTestManufacturer = (overrides: any = {}) => ({
  id: nextId(),
  uuid: uuidv4(),
  code: `MFG${String(idCounter).padStart(3, "0")}`,
  name: `Manufacturer ${idCounter}`,
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
});

/**
 * Supplier Factory
 */
export const createTestSupplier = (overrides: any = {}) => ({
  id: nextId(),
  uuid: uuidv4(),
  code: `SPL${String(idCounter).padStart(3, "0")}`,
  suppliesSheets: true,
  suppliesElaborated: false,
  suppliesConsumables: true,
  suppliesPaper: true,
  suppliesTooling: false,
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
});

/**
 * Paper Supply Factory
 */
export const createTestPaperSupply = (overrides: any = {}) => ({
  id: nextId(),
  uuid: uuidv4(),
  code: `PS${String(idCounter).padStart(3, "0")}`,
  name: `Paper Supply ${idCounter}`,
  description: "Test paper supply",
  manufacturerId: 1,
  supplierId: 1,
  minimumStockPallets: 10,
  minimumStockBoxes: 100,
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
});

/**
 * Invitation Factory
 */
export const createTestInvitation = (overrides: any = {}) => ({
  id: nextId(),
  uuid: uuidv4(),
  email: `invite${idCounter}@example.com`,
  role: "member" as const,
  companyId: 1,
  invitedBy: 1,
  token: `test-invitation-token-${idCounter}`,
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  isUsed: false,
  createdAt: now(),
  updatedAt: now(),
  ...overrides,
});

/**
 * Paginated Response Factory
 */
export const createPaginatedResponse = <T>(
  data: T[],
  page = 1,
  limit = 10,
  totalCount?: number,
) => ({
  success: true,
  data,
  page,
  limit,
  count: data.length,
  totalCount: totalCount ?? data.length,
  totalPages: Math.ceil((totalCount ?? data.length) / limit),
});

/**
 * API Response Factory
 */
export const createApiResponse = <T>(
  data: T,
  success = true,
  message?: string,
) => ({
  success,
  data,
  message,
});

/**
 * Error Response Factory
 */
export const createErrorResponse = (message: string, statusCode = 400) => ({
  success: false,
  message,
  statusCode,
});
