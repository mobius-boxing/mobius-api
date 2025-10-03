# Middleware Quick Reference Card

## Import
```typescript
import {
  // Auth
  authenticate, optionalAuth, requireRole, requireSuperAdmin,
  requireAdmin, requireSameCompany, generateToken,
  // Validation
  validateDTO, validate, validateUUID, validatePagination,
  validateRequiredFields,
  // Rate Limiting
  createRateLimiter, authRateLimiter, apiRateLimiter,
  publicRateLimiter, sensitiveRateLimiter,
  // Error
  errorMiddleware
} from '../middlewares';
```

---

## Authentication

| Middleware | Purpose | Usage |
|------------|---------|-------|
| `authenticate` | JWT required | `router.get('/profile', authenticate, ...)` |
| `optionalAuth` | JWT optional | `router.get('/public', optionalAuth, ...)` |
| `requireSuperAdmin()` | SuperAdmin only | `router.post('/admin', authenticate, requireSuperAdmin(), ...)` |
| `requireAdmin()` | Admin+ only | `router.delete('/:id', authenticate, requireAdmin(), ...)` |
| `requireRole([roles])` | Custom roles | `router.put('/:id', authenticate, requireRole(['admin', 'superAdmin']), ...)` |
| `requireSameCompany` | Same company | `router.get('/:companyId/data', authenticate, requireSameCompany, ...)` |
| `generateToken(user)` | Create JWT | `const token = generateToken({ id, uuid, email, role, companyId })` |

---

## Validation

| Middleware | Purpose | Usage |
|------------|---------|-------|
| `validateDTO(DTO)` | Class-validator DTO | `router.post('/', validateDTO(CreateDTO), ...)` |
| `validateDTO(DTO, 'query')` | Validate query params | `router.get('/', validateDTO(SearchDTO, 'query'), ...)` |
| `validateUUID()` | UUID in :uuid param | `router.get('/:uuid', validateUUID(), ...)` |
| `validateUUID('id')` | UUID in :id param | `router.get('/:id', validateUUID('id'), ...)` |
| `validatePagination` | page/limit params | `router.get('/', validatePagination, ...)` |
| `validateRequiredFields([])` | Required body fields | `router.post('/login', validateRequiredFields(['email', 'password']), ...)` |
| `validate(fn)` | Custom validation | `router.post('/', validate((req) => { ... }), ...)` |

---

## Rate Limiting

| Middleware | Limit | Window | Usage |
|------------|-------|--------|-------|
| `authRateLimiter` | 5 req | 1 min | `router.post('/login', authRateLimiter, ...)` |
| `apiRateLimiter` | 100 req | 15 min | `router.use(apiRateLimiter)` |
| `publicRateLimiter` | 200 req | 15 min | `router.get('/public', publicRateLimiter, ...)` |
| `sensitiveRateLimiter` | 3 req | 5 min | `router.delete('/account', sensitiveRateLimiter, ...)` |
| `createRateLimiter(max, min)` | Custom | Custom | `createRateLimiter(50, 10)` |

---

## req.user Type

After `authenticate` middleware:

```typescript
req.user = {
  userId: number;
  uuid: string;
  email: string;
  role: 'member' | 'admin' | 'superAdmin';
  companyId?: number;
}
```

---

## Common Patterns

### Public Registration
```typescript
router.post('/register',
  authRateLimiter,
  validateDTO(RegisterDTO),
  controller.register
);
```

### Protected Get All
```typescript
router.get('/',
  authenticate,
  requireAdmin(),
  validatePagination,
  apiRateLimiter,
  controller.getAll
);
```

### Protected Get One
```typescript
router.get('/:uuid',
  authenticate,
  validateUUID(),
  requireSameCompany,
  controller.getByUuid
);
```

### Protected Create
```typescript
router.post('/',
  authenticate,
  validateDTO(CreateDTO),
  apiRateLimiter,
  controller.create
);
```

### Protected Update
```typescript
router.put('/:uuid',
  authenticate,
  validateUUID(),
  validateDTO(UpdateDTO),
  requireSameCompany,
  controller.update
);
```

### Protected Delete
```typescript
router.delete('/:uuid',
  authenticate,
  requireAdmin(),
  validateUUID(),
  controller.delete
);
```

---

## Error Codes (Automatic)

| Error Type | Code | Status | Message |
|------------|------|--------|---------|
| Token expired | `TOKEN_EXPIRED` | 401 | "Token has expired. Please login again." |
| Invalid token | `INVALID_TOKEN` | 401 | "Invalid token. Please login again." |
| Unique violation | `DUPLICATE_ENTRY` | 409 | "email already exists. Please use a different value." |
| Foreign key | `FOREIGN_KEY_VIOLATION` | 400 | "Referenced record does not exist..." |
| Not null | `NOT_NULL_VIOLATION` | 400 | "field is required and cannot be null." |
| Validation | `VALIDATION_ERROR` | 400 | "Validation failed" |
| Rate limit | - | 429 | "Too many requests. Please try again after X seconds." |

---

## Environment Variables

```env
JWT_SECRET=kL9mN3pQ7rS5tV2wX4yB6zC8dF1gH4jM5nP7qT9vW3xY5zA7b
JWT_EXPIRE=5h
NODE_ENV=development
```

---

## Middleware Order (Best Practice)

```typescript
router.METHOD('/path',
  rateLimiter,          // 1. Rate limit (cheapest)
  authenticate,         // 2. Auth (before validation)
  requireRole([...]),   // 3. Authorization
  validateUUID(),       // 4. Param validation
  validateDTO(DTO),     // 5. Body validation
  controller.method     // 6. Controller
);
```

---

## Generate Token Example

```typescript
import { generateToken } from '../middlewares';
import bcrypt from 'bcryptjs';

const user = await userDAO.getUserByEmail(email);
const isValid = await bcrypt.compare(password, user.password);

if (isValid) {
  const token = generateToken({
    id: user.id,
    uuid: user.uuid,
    email: user.email,
    role: user.role,
    companyId: user.companyId
  });

  res.json({ success: true, token });
}
```

---

## DTO Example with class-validator

```typescript
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

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

  @IsOptional()
  @IsString()
  companyId?: string;
}

// Usage
router.post('/users', validateDTO(CreateUserDTO), controller.create);
```

---

## Dependencies Required

```bash
npm install jsonwebtoken bcryptjs class-validator class-transformer
npm install --save-dev @types/jsonwebtoken @types/bcryptjs
```

---

For detailed documentation, see:
- `README.md` - Complete documentation
- `EXAMPLES.md` - Code examples and best practices
