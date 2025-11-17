# Middleware Usage Examples

Quick reference guide for common middleware patterns.

## Authentication Examples

### Basic Protected Route

```typescript
import { authenticate } from "../middlewares";

router.get("/profile", authenticate, controller.getProfile);
```

### Admin Only Route

```typescript
import { authenticate, requireAdmin } from "../middlewares";

router.delete(
  "/users/:uuid",
  authenticate,
  requireAdmin(),
  controller.deleteUser,
);
```

### SuperAdmin Only Route

```typescript
import { authenticate, requireSuperAdmin } from "../middlewares";

router.post(
  "/companies",
  authenticate,
  requireSuperAdmin(),
  controller.createCompany,
);
```

### Same Company Access

```typescript
import { authenticate, requireSameCompany } from "../middlewares";

router.get(
  "/company/:companyId/data",
  authenticate,
  requireSameCompany,
  controller.getData,
);
```

### Optional Authentication

```typescript
import { optionalAuth } from "../middlewares";

// User info available if token provided, but endpoint works without it
router.get("/products", optionalAuth, controller.getProducts);
```

### Custom Role Check

```typescript
import { authenticate, requireRole } from "../middlewares";

router.put(
  "/settings",
  authenticate,
  requireRole(["admin", "superAdmin"]),
  controller.updateSettings,
);
```

---

## Validation Examples

### DTO Validation (Recommended)

```typescript
import { validateDTO } from "../middlewares";
import { CreateUserDTO } from "../dto/create-user.dto";

router.post("/users", validateDTO(CreateUserDTO), controller.create);

// In your DTO file (dto/create-user.dto.ts):
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
```

### Query Parameter Validation

```typescript
import { validateDTO } from "../middlewares";
import { SearchQueryDTO } from "../dto/search-query.dto";

router.get("/search", validateDTO(SearchQueryDTO, "query"), controller.search);
```

### UUID Validation

```typescript
import { validateUUID } from "../middlewares";

router.get("/users/:uuid", validateUUID(), controller.getByUuid);
router.get(
  "/companies/:companyId",
  validateUUID("companyId"),
  controller.getCompany,
);
```

### Pagination Validation

```typescript
import { validatePagination } from "../middlewares";

router.get("/users", validatePagination, controller.getAll);
```

### Required Fields Validation

```typescript
import { validateRequiredFields } from "../middlewares";

router.post(
  "/login",
  validateRequiredFields(["email", "password"]),
  controller.login,
);
```

### Custom Validation

```typescript
import { validate } from "../middlewares";

router.post(
  "/transfer",
  validate((req) => {
    if (!req.body.amount || req.body.amount <= 0) {
      throw new Error("Amount must be greater than 0");
    }
    if (req.body.amount > 10000) {
      throw new Error("Amount cannot exceed 10000");
    }
  }),
  controller.transfer,
);
```

---

## Rate Limiting Examples

### Authentication Endpoints (Strict)

```typescript
import { authRateLimiter } from "../middlewares";

router.post("/login", authRateLimiter, controller.login);
router.post("/register", authRateLimiter, controller.register);
router.post("/forgot-password", authRateLimiter, controller.forgotPassword);
```

### API Endpoints (Standard)

```typescript
import { apiRateLimiter } from "../middlewares";

// Apply to all routes in router
router.use(apiRateLimiter);

// Or apply to specific routes
router.post("/data", apiRateLimiter, controller.createData);
```

### Public Endpoints (Relaxed)

```typescript
import { publicRateLimiter } from "../middlewares";

router.get("/public/stats", publicRateLimiter, controller.getStats);
router.get("/public/docs", publicRateLimiter, controller.getDocs);
```

### Sensitive Operations (Very Strict)

```typescript
import { sensitiveRateLimiter } from "../middlewares";

router.delete("/account", sensitiveRateLimiter, controller.deleteAccount);
router.post("/export-data", sensitiveRateLimiter, controller.exportData);
router.post("/change-email", sensitiveRateLimiter, controller.changeEmail);
```

### Custom Rate Limiter

```typescript
import { createRateLimiter } from "../middlewares";

// 50 requests per 10 minutes
const uploadRateLimiter = createRateLimiter(50, 10, "Too many upload requests");

router.post("/upload", uploadRateLimiter, controller.upload);
```

---

## Combined Middleware Examples

### Complete CRUD Route Set

```typescript
import {
  authenticate,
  requireAdmin,
  requireSameCompany,
  validateDTO,
  validateUUID,
  validatePagination,
  apiRateLimiter,
} from "../middlewares";
import { CreateCustomerDTO, UpdateCustomerDTO } from "../dto/customer";

// List all (admin only, with pagination)
router.get(
  "/",
  authenticate,
  requireAdmin(),
  validatePagination,
  apiRateLimiter,
  controller.getAll,
);

// Get by UUID (authenticated, same company)
router.get(
  "/:uuid",
  authenticate,
  validateUUID(),
  requireSameCompany,
  controller.getByUuid,
);

// Create (authenticated, validated)
router.post(
  "/",
  authenticate,
  validateDTO(CreateCustomerDTO),
  apiRateLimiter,
  controller.create,
);

// Update (authenticated, validated, same company)
router.put(
  "/:uuid",
  authenticate,
  validateUUID(),
  validateDTO(UpdateCustomerDTO),
  requireSameCompany,
  controller.update,
);

// Delete (admin only)
router.delete(
  "/:uuid",
  authenticate,
  requireAdmin(),
  validateUUID(),
  controller.delete,
);
```

### Public Registration with Rate Limiting

```typescript
import { authRateLimiter, validateDTO } from "../middlewares";
import { RegisterDTO } from "../dto/auth/register.dto";

router.post(
  "/register",
  authRateLimiter, // Prevent spam
  validateDTO(RegisterDTO), // Validate input
  controller.register,
);
```

### Protected File Upload

```typescript
import { authenticate, createRateLimiter, validate } from "../middlewares";

const uploadLimiter = createRateLimiter(20, 60); // 20 uploads per hour

router.post(
  "/upload",
  authenticate,
  uploadLimiter,
  validate((req) => {
    if (!req.file) throw new Error("No file provided");
    if (req.file.size > 5 * 1024 * 1024) {
      throw new Error("File must be less than 5MB");
    }
  }),
  controller.uploadFile,
);
```

### Multi-Level Authorization

```typescript
import {
  authenticate,
  requireRole,
  requireSameCompany,
  validateUUID,
} from "../middlewares";

router.put(
  "/users/:uuid/role",
  authenticate, // Must be logged in
  validateUUID(), // Valid UUID format
  requireSameCompany, // Same company (or superAdmin)
  requireRole(["admin", "superAdmin"]), // Admin or higher
  controller.updateUserRole,
);
```

---

## Token Generation Examples

### Login Controller

```typescript
import { generateToken } from '../middlewares';
import bcrypt from 'bcryptjs';

public async login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await this.userDAO.getUserByEmail(email);
    if (!user) {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
      return;
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
      return;
    }

    // Generate token
    const token = generateToken({
      id: user.id,
      uuid: user.uuid,
      email: user.email,
      role: user.role,
      companyId: user.companyId
    });

    res.json({
      success: true,
      token,
      user: {
        uuid: user.uuid,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      }
    });
  } catch (err) {
    next(err);
  }
}
```

### Register Controller

```typescript
import { generateToken } from '../middlewares';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

public async register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, firstName, lastName } = req.body;

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const newUser = await this.userDAO.create({
      uuid: uuidv4(),
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role: 'member',
      isActive: true,
      emailVerified: false
    });

    // Generate token
    const token = generateToken(newUser);

    res.status(201).json({
      success: true,
      token,
      user: {
        uuid: newUser.uuid,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        role: newUser.role
      }
    });
  } catch (err) {
    next(err);
  }
}
```

---

## Error Handling Examples

### Automatic Error Handling

```typescript
// Just throw errors or pass to next(), middleware handles them automatically

public async create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // JWT errors are automatically handled
    // Database errors are automatically handled
    // Validation errors are automatically handled

    const result = await this.dao.create(req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err); // Error middleware handles it
  }
}
```

### Custom Error Codes

```typescript
public async getByUuid(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await this.dao.getByUuid(req.params.uuid);

    if (!result) {
      // Custom error with specific status
      const error: any = new Error('Resource not found');
      error.statusCode = 404;
      throw error;
    }

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
```

---

## Best Practices

### 1. Order of Middleware Matters

```typescript
// ✅ Correct order
router.post(
  "/users",
  authRateLimiter, // 1. Rate limit first (cheapest check)
  authenticate, // 2. Then authenticate (before validation)
  requireAdmin(), // 3. Then authorize
  validateDTO(DTO), // 4. Then validate input
  controller.create, // 5. Finally, controller logic
);

// ❌ Incorrect - wastes resources
router.post(
  "/users",
  validateDTO(DTO), // Validates for unauthenticated users
  authenticate, // Should be before validation
  controller.create,
);
```

### 2. Chain Middleware Logically

```typescript
// ✅ Good - clear and logical
router.put(
  "/:uuid",
  authenticate,
  validateUUID(),
  validateDTO(UpdateDTO),
  requireSameCompany,
  controller.update,
);
```

### 3. Use Appropriate Rate Limiters

```typescript
// ✅ Good - strict for auth
router.post("/login", authRateLimiter, controller.login);

// ✅ Good - relaxed for public
router.get("/public/info", publicRateLimiter, controller.getInfo);

// ❌ Bad - too strict for regular API
router.get("/users", authRateLimiter, controller.getUsers); // Use apiRateLimiter instead
```

### 4. Always Use Validation

```typescript
// ✅ Good - validated input
router.post("/users", validateDTO(CreateUserDTO), controller.create);

// ❌ Bad - no validation
router.post("/users", controller.create); // Vulnerable to malicious input
```

### 5. Protect Sensitive Operations

```typescript
// ✅ Good - multiple layers of protection
router.delete(
  "/account",
  authenticate,
  sensitiveRateLimiter,
  validateRequiredFields(["password", "confirmation"]),
  controller.deleteAccount,
);
```
