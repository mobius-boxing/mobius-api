/**
 * Jest Test Setup
 * This file runs before all tests
 */

import { jest } from '@jest/globals';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.JWT_EXPIRE = '1h';

// Global test timeout
jest.setTimeout(30000);

// Mock console.error to reduce noise in tests (optional)
// const originalError = console.error;
// beforeAll(() => {
//   console.error = jest.fn();
// });
// afterAll(() => {
//   console.error = originalError;
// });

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});
