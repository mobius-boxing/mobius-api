# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development

- `npm run start:dev` - Start development server with auto-reload (uses nodemon)
- `npm run build` - Compile TypeScript to JavaScript (output to dist/)
- `npm start` - Run production server from compiled dist/

### Code Quality

- `npm run format` - Format code with Prettier
- No linting command configured - consider using ESLint with the installed configuration

### Testing

- `npm test` - Run tests with Jest (no test files found yet)

### Utilities

- `npm run create:controller` - Generate new controller using Sundays Framework CLI

## Architecture

This is a Dupin API v2 backend built with Express.js and TypeScript following a modular MVC pattern.

### Core Structure

- **Entry Points**: `src/server.ts` initializes the server, `src/app.ts` configures Express middleware
- **Routing**: Dynamic route loading system in `src/routes/index.ts` that automatically discovers and mounts routers from subdirectories
- **Controllers**: Business logic separated into controller classes (e.g., `HealthController`, `LogsController`)
- **Middleware**: Error handling middleware in `src/middlewares/error/`
- **Configuration**: CORS origins managed in `src/common/config/origins/`

### Key Patterns

1. **Router Auto-Discovery**: The `IndexRouter` class scans the routes directory and automatically mounts any `*.router.ts` files found in subdirectories. Routes are mounted at `/{folder-name}`.

2. **Controller Pattern**: Each router has a corresponding controller class that handles the business logic. Controllers are bound to router methods using `.bind()` to maintain proper context.

3. **Environment Configuration**: Uses dotenv for environment variables. Server port defaults to 3005 if not specified in .env.

4. **CORS Configuration**: Dynamic CORS origin configuration via `getAllowedOrigins()` function.

5. **Dependencies**:
   - Local Knex module at `@dupin/knex-v2` (linked from ../knex)
   - Sundays Framework utilities for scaffolding
   - Standard Express middleware (cors, morgan, etc.)

### TypeScript Configuration

- Strict mode enabled with all strict checks
- Compiles to ES2016, CommonJS modules
- Source in `./src`, output to `./dist`
- Unused locals will cause compilation errors

## Controller Implementation Guide

When creating new controllers, follow the established pattern demonstrated in the CompanyController:

### 1. Controller Structure

```typescript
import { Request, Response, NextFunction } from "express";
import { IBaseController } from "../../types";
import { inputValidator, IInputValidator, paginationHelper } from "@sundaysf/utils";
import { [Entity]DAO, I[Entity], IDataPaginator } from "@dupin/knex-v2";
import { [Entity]CreateInputDTO } from "../../dto/input/[entity]/[entity].create.dto";
import { [Entity]UpdateInputDTO } from "../../dto/input/[entity]/[entity].update.dto";
import { v4 as uuidv4 } from 'uuid';

export class [Entity]Controller implements IBaseController {
  private _[entity]DAO: [Entity]DAO = new [Entity]DAO();

  // Implement CRUD methods
}
```

### 2. API Response Format

All API responses must follow a consistent format:

**Success Response**:

```json
{
  "success": true,
  "data": {...} // or "message": "Action completed successfully" for operations without data
}
```

**Error Response**:

```json
{
  "success": false,
  "message": "Error description"
}
```

**Paginated Response** (from IDataPaginator):

```json
{
  "success": true,
  "data": [...],
  "page": 1,
  "limit": 10,
  "count": 10,
  "totalCount": 100,
  "totalPages": 10
}
```

Note: The `IDataPaginator` interface already includes the standard response format with `success` and `data` fields, so responses from paginated endpoints should be returned directly without additional wrapping.

### 3. Standard CRUD Methods

**getAll** - List with pagination:

```typescript
public async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const {page, limit} = paginationHelper(req);
    const result: IDataPaginator<I[Entity]> = await this._[entity]DAO.getAll(page, limit);
    res.status(200).json(result); // IDataPaginator already includes success and data fields
  } catch (err: any) {
    next(err);
  }
}
```

**getByUuid** - Get single resource:

```typescript
public async getByUuid(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { uuid } = req.params;
    const result = await this._[entity]DAO.getByUuid(uuid);
    if (!result) {
      res.status(404).json({ success: false, message: "[Entity] not found" });
      return;
    }
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err: any) {
    next(err);
  }
}
```

**create** - Create new resource with DTO validation:

```typescript
public async create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = req.body;
    const inputDTO = new [Entity]CreateInputDTO(data).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      return next(new Error(validation.message));
    }
    const dataToCreate = {...inputDTO, uuid: uuidv4()};
    const result = await this._[entity]DAO.create(dataToCreate);
    res.status(201).json({
      success: true,
      data: result
    });
  } catch (err: any) {
    next(err);
  }
}
```

**update** - Update existing resource with DTO validation:

```typescript
public async update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { uuid } = req.params;
    const data = req.body;

    // First get the entity by UUID to find its ID
    const existing = await this._[entity]DAO.getByUuid(uuid);
    if (!existing || !existing.id) {
      res.status(404).json({ success: false, message: "[Entity] not found" });
      return;
    }

    const inputDTO = new [Entity]UpdateInputDTO(data).build();
    const validation: IInputValidator = await inputValidator(inputDTO);
    if (!validation.success) {
      req.statusCode = 400;
      return next(new Error(validation.message));
    }

    const result = await this._[entity]DAO.update(existing.id, inputDTO);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err: any) {
    next(err);
  }
}
```

**delete** - Delete resource:

```typescript
public async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { uuid } = req.params;

    // First get the entity by UUID to find its ID
    const existing = await this._[entity]DAO.getByUuid(uuid);
    if (!existing || !existing.id) {
      res.status(404).json({ success: false, message: "[Entity] not found" });
      return;
    }

    const result = await this._[entity]DAO.delete(existing.id);
    if (result) {
      res.status(200).json({ success: true, message: "[Entity] deleted successfully" });
    } else {
      res.status(404).json({ success: false, message: "Failed to delete [entity]" });
    }
  } catch (err: any) {
    next(err);
  }
}
```

### 4. Router Implementation

Create a corresponding router in `src/routes/[entity]/[entity].router.ts`:

```typescript
import { Router } from "express";
import { [Entity]Controller } from "../../controllers/[entity]/[entity].controller";

export class [Entity]Router {
  private _router: Router;
  private _[entity]Controller = new [Entity]Controller();

  constructor() {
    this._router = Router();
    this.initRoutes();
  }

  private initRoutes(): void {
    this._router.get("/", this._[entity]Controller.getAll.bind(this._[entity]Controller));
    this._router.get("/:uuid", this._[entity]Controller.getByUuid.bind(this._[entity]Controller));
    this._router.post("/", this._[entity]Controller.create.bind(this._[entity]Controller));
    this._router.put("/:uuid", this._[entity]Controller.update.bind(this._[entity]Controller));
    this._router.delete("/:uuid", this._[entity]Controller.delete.bind(this._[entity]Controller));
  }

  public get router(): Router {
    return this._router;
  }
}
```

### 5. DTO Implementation

Create DTOs to validate and sanitize input data:

**Create DTO** (`src/dto/input/[entity]/[entity].create.dto.ts`):

```typescript
export class [Entity]CreateInputDTO {
    // Define only allowed properties
    property1: type;
    property2: type;

    constructor(data: any){
        this.property1 = data.property1;
        this.property2 = data.property2;
        // Set defaults for optional properties
    }

    public build(): this {
        return this;
    }
}
```

**Update DTO** (`src/dto/input/[entity]/[entity].update.dto.ts`):

```typescript
export class [Entity]UpdateInputDTO {
    // Define optional properties
    property1?: type;
    property2?: type;

    constructor(data: any){
        // Only set properties that are present in the input
        if (data.property1 !== undefined) this.property1 = data.property1;
        if (data.property2 !== undefined) this.property2 = data.property2;
    }

    public build(): this {
        // Remove any properties that weren't set
        const cleanData: any = {};
        if (this.property1 !== undefined) cleanData.property1 = this.property1;
        if (this.property2 !== undefined) cleanData.property2 = this.property2;

        // Clear all properties and reassign only the allowed ones
        Object.keys(this).forEach(key => delete (this as any)[key]);
        Object.assign(this, cleanData);

        return this;
    }
}
```

### 6. Working with Related Entities

When your entity has foreign key relationships, the DAOs in @dupin/knex-v2 will automatically include related entities using PostgreSQL's `to_jsonb()` function. For example:

- `UserDAO` methods return users with their associated `company` object
- The join is handled at the database level for optimal performance
- No additional API logic is needed to include related data

Example response structure:

```json
{
  "id": 1,
  "uuid": "...",
  "name": "John",
  "lastName": "Doe",
  "companyId": 1,
  "company": {
    "id": 1,
    "uuid": "...",
    "name": "Company Name"
    // ... other company fields
  }
}
```

### 7. Important Notes

- Always use `.bind()` when assigning controller methods to router to maintain proper context
- Use UUID for public-facing endpoints (params) but convert to ID for internal DAO operations
- Return appropriate HTTP status codes (200, 201, 404, etc.)
- Pass errors to the next() function for centralized error handling
- Use paginationHelper from @sundaysf/utils for consistent pagination
- Use DTOs to validate and sanitize input data, preventing unwanted fields from being processed
- DTOs ensure only allowed fields are passed to the DAO layer
- Update DTOs should handle partial updates properly
- Always generate UUID in the controller for new resources (not in DTO or client-side)
- All API responses must follow the standard format: `{success: boolean, data?: any, message?: string}`
- Use status 200 for successful DELETE operations (not 204) to include success message
