# mobius-api

Express 5 + TypeScript + Knex/Postgres API. Routers are auto-discovered:
`src/routes/<entity>/<entity>.router.ts` mounts at `/<entity>` (folder name =
route path). Entry: `src/server.ts` / `src/app.ts`. PORT falls back to 3005 —
local dev sets `PORT=3001` in `.env`.

## Commands

- `npm run start:dev` — dev server (nodemon)
- `npm run build` — compile to dist/ (fails on type errors)
- `npm test` — jest (tests in `src/__tests__/`)
- `npm run format` — prettier (eslint + tsc also run per-edit via hook)
- `npm run migrate:deploy` / `migrate:create` / `migrate:rollback` (never against prod); `seed:run` / `seed:create`
- `npm run create:controller` — Sundays CLI scaffold
- `npm run deploy` — read `../docs/infra.md` first

## Conventions (full guides: `../docs/new_entity_guide.md` + `../docs/main_endpoint_guide.md`)

- Plain-CRUD controllers extend `BaseCrudController` (owns company scoping,
  fk-catch, audit). Hand-roll only for atomic multi-entity writes or
  non-CRUD verbs — still `implements IBaseController`. No third shape.
- Every list endpoint uses the shared query builder (`src/utils/queryBuilder.ts`):
  flat `?field=value` filters, reserved params page/limit/sortBy/sortOrder/search,
  Filter/Sort configs OUTSIDE the DAO class, `getAllWithFilters(req)` →
  `IDataPaginator` returned unwrapped. Reference: `src/dao/warehouse/warehouse.dao.ts`.
- `inputValidator` (@sundaysf/utils) only rejects empty objects — DTOs must
  THROW inside `build()` for required fields and numeric sanity.
- Writes gated by `requirePermission(<catalogue code>)` via rbac.service —
  never bare `requireAdmin()` or inline superAdmin checks.
- UUID-only public API: numeric id/FKs never leave the API (`sanitizeResponse`
  and per-DAO `mapToInterface`); DTOs accept `*Uuid`; `uuidv4()` generated in
  the controller.
- Envelopes: `{success: true, data}` / `{success: false, message}`;
  paginated responses returned unwrapped; DELETE returns 200 with a message.

Deeper style rules load via the `code-style` skill; hard-won traps live in
the workspace lessons index (`../../.claude/lessons/INDEX.md`).
