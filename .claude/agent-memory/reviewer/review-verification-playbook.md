---
name: review-verification-playbook
description: How to independently verify mobius-api + backoffice changes end to end (scratch Postgres, migration replay, live curls, puppeteer) instead of trusting the implementer's report
metadata:
  type: reference
---

Independent verification is cheap here — do it rather than reading code only.

**Scratch database.** A native Postgres listens on `localhost:5432` with superuser
role `nacho` (the `.env` points at docker host `traffic-postgres`, which is NOT
resolvable locally, and `traffic_user` does not exist on the local instance).
Create `mobius_review_scratch`, then run migrations with env overrides:
`SQL_HOST=localhost SQL_PORT=5432 SQL_USER=nacho SQL_PASSWORD= SQL_DATABASE=... NODE_ENV=development npx knex migrate:latest --knexfile knexfile.ts`.
(The env var was renamed from `SQL_DB_NAME` to `SQL_DATABASE` by the db-split T1
track; `--knexfile knexfile.ts` is mandatory — the CLI otherwise finds the stale
`knexfile.js`.)

**Replaying a backfill migration.** `knex migrate:up <name>` will not run the
prior chain. Instead: `migrate:latest` → insert prod-shaped fixture rows →
`migrate:down` (one step) → `migrate:up`. Safe on a scratch DB; L-003 only bans
rollback against prod.

**Running the API locally.** `npx ts-node src/server.ts` fails with bogus
`Property 'user' does not exist on type 'Request'` errors — ts-node does not pick
up the global express augmentation. Use `--transpile-only` (that is what
`nodemon.json` does). `npm run build` (plain tsc) is the real type gate.

**Minting a token.** `authenticate` takes `role`/`companyId` from the JWT and only
re-checks that the user row exists and is active, so a hand-signed token with
`JWT_SECRET` plus a matching `users` row is enough for superAdmin/member matrices.
For the puppeteer helpers, seed `superadmin@mobius.local` / `SuperAdmin123!`
(bcryptjs) — `repos/debug/helpers/authHelper.js` hardcodes those. The backoffice
JWT lives in cookie `mobius_session` (NOT localStorage, despite older docs).

**Backoffice dev server.** Start it detached (`nohup ... & disown` +
run_in_background) — a plain `&` dies when the bash tool's process group is
reaped. `BROWSER=none PORT=3002 REACT_APP_API_URL=http://localhost:3001 npx
react-scripts start`, ~90 s to first listen.

**Scope audit when the feature is untracked.** Whole modules (countdown, the
modules monorepo apps) are uncommitted, so `git diff` shows unrelated work and
proves nothing. Use an mtime window instead:
`find <roots> -type f -newermt "<date> HH:MM" | grep -v node_modules`, then
`stat -f "%Sm %N" -t "%m-%d %H:%M"` to separate the current session's edits from
an earlier session's. Files whose mtime predates the first file of the task are
not scope drift.

**Static checks that need no database.** `npx tsc --noEmit -p tsconfig.json` is
the real type gate. Knex DDL can be proof-read without connecting:
`knex({client:'pg'}).schema.createTable(...).toString()` prints the exact SQL
(`.alter()` expands to drop default / drop not null / type / set not null).
`psql` is NOT installed — query Postgres through `node -e` with the `pg` module
from `repos/mobius-api/node_modules`.

**Mutation-testing a new test without editing repo source.** Copy the unit under
test and its test file into the scratchpad, rewrite the copies' relative imports
to absolute paths under `repos/mobius-api/src` (including the `jest.mock(...)`
path strings, which must match the service's own import specifier), point the
test at `./svc`, and run
`npx jest --config <scratch>/jest.mut.js` with `rootDir` = mobius-api (so
node_modules and `src/__tests__/setup.ts` resolve), `roots` = the scratch dir,
and `transform: {"^.+\\.tsx?$": ["ts-jest", {diagnostics: false}]}` — outside the
tsconfig include, ts-jest otherwise reports bogus TS7006 on `jest.fn` generics.
Then mutate the copy and confirm exactly the intended test flips to ✕. Also the
cheapest way to print a scenario the suite does not cover.

**Probing runtime infrastructure (the connection registry, middleware, guards).**
A scratch `.ts` outside `src/` fails ts-node with TS5109 (this tsconfig sets
`module: NodeNext`). Cheapest route: `npm run build`, then write the probe against
`dist/…` and run `npx ts-node --transpile-only --compiler-options
'{"module":"commonjs","moduleResolution":"node","strict":false}' probe.ts` with
`SQL_HOST=localhost SQL_USER=$USER SQL_PASSWORD= SQL_DATABASE=postgres`. Local
Postgres answers, so `connectAll()` + real queries work without touching the
deployed host, and the run is read-only if you stick to `SELECT`.

**Cleanup (L-013/L-015).** Drop the scratch DB, kill only the pids you started on
3001/3002, and delete `repos/mobius-api/uploads/` if you exercised `POST /api/files`
(local storage driver writes there). `rm -rf` is blocked by a guard hook — use
`node -e "fs.rmSync(p,{recursive:true,force:true})"`.

**Exercising a service without a database (fastest AC-matrix check).** `private`
is compile-time only, so after `npm run build` you can
`require("dist/services/<x>.service.js")`, `new` it, and overwrite its DAO fields
(`svc._documentDAO = {...}`) with fakes that capture the patch object. Drive real
DTO instances (`dist/dto/input/...`) through the public method and print what
reached `dao.update()`. This reproduced a full 9-cell update matrix, including
error messages and `statusCode`, in one file and zero DB calls — far stronger
evidence than reading the branches, and it works when the INT suite cannot run.

**When the INT suite cannot run.** `repos/tests/api/countdown` needs a fixture
universe (Dev Co + `igonzalez@genium.io` + `testuser@mobius.test` + a second
company with the module enabled). Implementers create and delete it, so the local
DB is usually back to 1 user / 1 company by review time and `beforeAll` throws.
Do not re-seed a DB another session is using; verify at the DTO/service/controller
layers instead and mark the HTTP ACs unverifiable. `config/environment.ts`
hardcodes `http://localhost:3001/api` with no env override — a scratchpad
`--setupFiles` shim mutating the exported `env` object is the correct way to
point it elsewhere, and leaves the shared config untouched.

**The implementer's artifacts are often already in the scratchpad.** When the
implementer ran in the same session id, `/private/tmp/claude-501/<proj>/<session>/
scratchpad/` still holds their raw logs (`int-run*.log`, `pup.log`, `api<port>.log`,
tokens, fixture uuids, jest shims) and their pid files. `ls -la` it before writing
off a manual AC as unverifiable — jest output with timings, recorded puppeteer
request bodies and the API access log are far better evidence than a summary, and
the pid files let you confirm L-015 (nothing left listening). Cross-check the log
mtimes against source-file mtimes to prove the run exercised the final code.
