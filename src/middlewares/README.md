# Middleware Documentation

This directory contains all middleware for the Mobius API v2. All middleware can be imported from the index file.

## Table of Contents

1. [Authentication Middleware](#authentication-middleware)
2. [Validation Middleware](#validation-middleware)
3. [Rate Limiting Middleware](#rate-limiting-middleware)
4. [Error Handling Middleware](#error-handling-middleware)

---

## Authentication Middleware

Location: `src/middlewares/auth.middleware.ts`

### Functions

#### `authenticate()`

Verifies JWT token from Authorization header and attaches user to `req.user`.

**Usage:**

```typescript
import { authenticate } from "../middlewares";

router.get("/profile", authenticate, controller.getProfile);
```

**Response on failure:**

- Status: 401
- Body: `{ success: false, message: "Authentication required. No token provided." }`

---

#### `optionalAuth()`

Non-blocking authentication. Sets `req.user` if token is present but continues if missing.

**Usage:**

```typescript
import { optionalAuth } from "../middlewares";

router.get("/products", optionalAuth, controller.getProducts);
```

---

#### `requireRole(['admin', 'superAdmin'])`

Role-based access control. Ensures authenticated user has one of the specified roles.

**Usage:**

```typescript
import { authenticate, requireRole } from "../middlewares";

router.delete(
  "/users/:uuid",
  authenticate,
  requireRole(["admin", "superAdmin"]),
  controller.deleteUser,
);
```

**Response on failure:**

- Status: 403
- Body: `{ success: false, message: "Insufficient permissions. Required role: admin or superAdmin" }`

---

#### `requireSuperAdmin()`

Shorthand for requiring SuperAdmin role only.

**Usage:**

```typescript
import { authenticate, requireSuperAdmin } from "../middlewares";

router.post(
  "/companies",
  authenticate,
  requireSuperAdmin(),
  controller.createCompany,
);
```

---

#### `requireAdmin()`

Shorthand for requiring Admin or SuperAdmin role.

**Usage:**

```typescript
import { authenticate, requireAdmin } from "../middlewares";

router.put(
  "/settings",
  authenticate,
  requireAdmin(),
  controller.updateSettings,
);
```

---

#### `requireSameCompany()`

Ensures user belongs to the same company as the resource. SuperAdmins can access any company.

**Usage:**

```typescript
import { authenticate, requireSameCompany } from "../middlewares";

router.get(
  "/company/:companyId/customers",
  authenticate,
  requireSameCompany,
  controller.getCustomers,
);
```

**Notes:**

- Looks for company ID in `req.params.companyId`, `req.body.companyId`, or `req.query.companyId`
- SuperAdmins bypass this check
- Returns 403 if user's company doesn't match resource company

---

#### `generateToken(user)`

Utility function to generate JWT tokens.

**Usage:**

```typescript
import { generateToken } from "../middlewares";

const token = generateToken({
  id: user.id,
  uuid: user.uuid,
  email: user.email,
  role: user.role,
  companyId: user.companyId,
});

res.json({ success: true, token });
```

**Environment Variables Required:**

- `JWT_SECRET` - Secret key for signing tokens
- `JWT_EXPIRE` - Token expiration time (default: "5h")

---

## Validation Middleware

Location: `src/middlewares/validation.middleware.ts`

### Functions

#### `validateDTO(DTOClass, source?)`

Generic DTO validation using class-validator decorators.

**Parameters:**

- `DTOClass` - The DTO class to validate against
- `source` - Where to get data from: `'body'` (default), `'query'`, or `'params'`

**Usage with DTO:**

```typescript
// Create DTO with class-validator decorators
import { IsEmail, IsString, MinLength } from "class-validator";

export class CreateUserDTO {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;
}

// Use in router
import { validateDTO } from "../middlewares";
import { CreateUserDTO } from "../dto/create-user.dto";

router.post("/users", validateDTO(CreateUserDTO), controller.createUser);
```

**Response on validation failure:**

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "email",
      "errors": ["email must be an email"]
    },
    {
      "field": "password",
      "errors": ["password must be longer than or equal to 8 characters"]
    }
  ]
}
```

---

#### `validate(validationFn)`

Simple validation without DTO classes.

**Usage:**

```typescript
import { validate } from "../middlewares";

router.get(
  "/:id",
  validate((req) => {
    if (!req.params.id) throw new Error("ID is required");
    if (isNaN(Number(req.params.id))) throw new Error("ID must be a number");
  }),
  controller.getById,
);
```

---

#### `validateUUID(paramName?)`

Validates UUID v4 format in route parameters.

**Usage:**

```typescript
import { validateUUID } from "../middlewares";

router.get("/users/:uuid", validateUUID(), controller.getByUuid);
router.get(
  "/companies/:companyUuid",
  validateUUID("companyUuid"),
  controller.getCompany,
);
```

---

#### `validatePagination()`

Validates pagination query parameters (`page` and `limit`).

**Usage:**

```typescript
import { validatePagination } from "../middlewares";

router.get("/users", validatePagination, controller.getAll);
```

**Rules:**

- `page` must be a positive integer (≥ 1)
- `limit` must be a positive integer between 1 and 100

---

#### `validateRequiredFields(fields)`

Validates that specific fields exist in request body.

**Usage:**

```typescript
import { validateRequiredFields } from "../middlewares";

router.post(
  "/login",
  validateRequiredFields(["email", "password"]),
  controller.login,
);
```

---

## Rate Limiting Middleware

Location: `src/middlewares/rate-limit.middleware.ts`

### Functions

#### `createRateLimiter(max, windowMinutes, message?)`

Create custom rate limiter.

**Parameters:**

- `max` - Maximum requests allowed in the window
- `windowMinutes` - Time window in minutes
- `message` - Optional custom error message

**Usage:**

```typescript
import { createRateLimiter } from "../middlewares";

// Allow 100 requests per 15 minutes
router.post("/api/data", createRateLimiter(100, 15), controller.getData);

// Allow 5 requests per minute with custom message
router.post(
  "/reset-password",
  createRateLimiter(5, 1, "Too many password reset attempts"),
  controller.resetPassword,
);
```

**Response Headers:**

- `X-RateLimit-Limit` - Maximum requests allowed
- `X-RateLimit-Remaining` - Remaining requests in current window
- `X-RateLimit-Reset` - When the rate limit resets (ISO timestamp)
- `Retry-After` - Seconds until rate limit resets (only when limit exceeded)

**Response on limit exceeded:**

```json
{
  "success": false,
  "message": "Too many requests. Please try again after 120 seconds.",
  "retryAfter": 120
}
```

---

### Preset Rate Limiters

#### `authRateLimiter`

For authentication endpoints (5 requests/minute)

```typescript
import { authRateLimiter } from "../middlewares";

router.post("/login", authRateLimiter, controller.login);
router.post("/register", authRateLimiter, controller.register);
```

---

#### `apiRateLimiter`

Standard API endpoints (100 requests/15 minutes)

```typescript
import { apiRateLimiter } from "../middlewares";

router.use("/api", apiRateLimiter);
```

---

#### `publicRateLimiter`

Public endpoints (200 requests/15 minutes)

```typescript
import { publicRateLimiter } from "../middlewares";

router.get("/public/status", publicRateLimiter, controller.getStatus);
```

---

#### `sensitiveRateLimiter`

Sensitive operations (3 requests/5 minutes)

```typescript
import { sensitiveRateLimiter } from "../middlewares";

router.delete("/account", sensitiveRateLimiter, controller.deleteAccount);
router.post("/export-data", sensitiveRateLimiter, controller.exportData);
```

---

### Utility Functions

#### `clearRateLimit(identifier)`

Clear rate limit for specific identifier.

```typescript
import { clearRateLimit } from "../middlewares";

clearRateLimit("user:123");
clearRateLimit("ip:192.168.1.1");
```

---

#### `clearAllRateLimits()`

Clear all rate limits (useful for testing).

```typescript
import { clearAllRateLimits } from "../middlewares";

clearAllRateLimits();
```

---

#### `getRateLimitStatus(identifier)`

Get current rate limit status.

```typescript
import { getRateLimitStatus } from "../middlewares";

const status = getRateLimitStatus("user:123");
// Returns: { count: 5, resetTime: 1234567890 } or null
```

---

## Error Handling Middleware

Location: `src/middlewares/error/error.middleware.ts`

### Enhanced Error Handling

The error middleware automatically handles:

#### JWT Errors

- `TokenExpiredError` → 401: "Token has expired. Please login again."
- `JsonWebTokenError` → 401: "Invalid token. Please login again."
- `NotBeforeError` → 401: "Token not active yet."

#### Database Errors (PostgreSQL)

- `23505` (Unique Constraint) → 409: "email already exists. Please use a different value."
- `23503` (Foreign Key) → 400: "Referenced record does not exist..."
- `23502` (Not Null) → 400: "field is required and cannot be null."
- `23514` (Check Constraint) → 400: "Data violates database constraints."
- `22P02` (Invalid Type) → 400: "Invalid data type provided."
- `42P01` (Undefined Table) → 500: "Database table not found."
- `42703` (Undefined Column) → 500: "Database column not found."

#### Validation Errors

All validation errors return 400 with formatted error details.

#### File Upload Errors (Multer)

- `LIMIT_FILE_SIZE` → 400: "File size exceeds the allowed limit."
- `LIMIT_FILE_COUNT` → 400: "Too many files uploaded."

### Usage

The error middleware is already registered in your Express app. Just pass errors to `next()`:

```typescript
try {
  // Your code
} catch (error) {
  next(error); // Error middleware handles it automatically
}
```

### Development Mode

In development (`NODE_ENV=development`), error responses include stack traces:

```json
{
  "success": false,
  "message": "Error message",
  "stack": "Error stack trace...",
  "details": {
    /* Full error object */
  }
}
```

---

## Complete Router Example

Here's a complete example using all middleware types:

```typescript
import { Router } from "express";
import {
  authenticate,
  requireAdmin,
  requireSameCompany,
  validateDTO,
  validateUUID,
  validatePagination,
  apiRateLimiter,
  authRateLimiter,
} from "../middlewares";
import { UserController } from "../controllers/user.controller";
import { CreateUserDTO } from "../dto/create-user.dto";
import { UpdateUserDTO } from "../dto/update-user.dto";

export class UserRouter {
  private _router: Router;
  private _controller = new UserController();

  constructor() {
    this._router = Router();
    this.initRoutes();
  }

  private initRoutes(): void {
    // Public route with rate limiting
    this._router.post(
      "/register",
      authRateLimiter,
      validateDTO(CreateUserDTO),
      this._controller.register.bind(this._controller),
    );

    // Protected routes
    this._router.get(
      "/",
      authenticate,
      requireAdmin(),
      validatePagination,
      apiRateLimiter,
      this._controller.getAll.bind(this._controller),
    );

    this._router.get(
      "/:uuid",
      authenticate,
      validateUUID(),
      this._controller.getByUuid.bind(this._controller),
    );

    this._router.post(
      "/",
      authenticate,
      requireAdmin(),
      validateDTO(CreateUserDTO),
      this._controller.create.bind(this._controller),
    );

    this._router.put(
      "/:uuid",
      authenticate,
      validateUUID(),
      validateDTO(UpdateUserDTO),
      requireSameCompany,
      this._controller.update.bind(this._controller),
    );

    this._router.delete(
      "/:uuid",
      authenticate,
      requireAdmin(),
      validateUUID(),
      this._controller.delete.bind(this._controller),
    );
  }

  public get router(): Router {
    return this._router;
  }
}
```

---

## Environment Variables

Required in `.env` file:

```env
JWT_SECRET=kL9mN3pQ7rS5tV2wX4yB6zC8dF1gH4jM5nP7qT9vW3xY5zA7b
JWT_EXPIRE=5h
NODE_ENV=development
```

---

## TypeScript Types

The `req.user` object has the following type (defined in `src/types.d.ts`):

```typescript
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: number;
        uuid: string;
        email: string;
        role: "member" | "admin" | "superAdmin";
        companyId?: number;
      };
    }
  }
}
```

Access user info in controllers:

```typescript
public async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // TypeScript knows req.user exists and its shape
    const userId = req.user!.userId;
    const role = req.user!.role;

    // Your logic here
  } catch (err) {
    next(err);
  }
}
```
