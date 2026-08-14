---
name: recurring-review-findings
description: Defect shapes that keep recurring in Mobius feature work — check these explicitly on every review
metadata:
  type: project
---

Check these on every review; each has already been found at least once.

- **Dead i18n keys / untranslated fallbacks.** New `*.error.*` keys get added to
  both locales and then never referenced, because `hooks/useModalForm` already
  owns the catch path and falls back to a hardcoded English `'An error occurred'`.
  Any AC phrased as ``err?.response?.data?.message || t('…')`` is NOT satisfied by
  delegating to `useModalForm`; the caller must own its try/catch. Grep every new
  locale key for a call site.
- **Form-refill guards cut both ways.** Guarding a refill effect with
  `if (isDirty) return` stops a sibling refetch from eating the user's draft, but
  if the dirty flags are also effect *dependencies*, clearing them after a
  successful save re-fires the effect against the still-stale prop and reverts the
  form to pre-save values. With a wholesale-replacement PUT the user then clicks
  Save again and destroys their own change. Keep dirty flags out of the dep array
  (read via refs) so the effect fires only on real prop change. Probe it by
  aborting the follow-up GET, not by watching the happy path — on localhost the
  refetch lands in ~10 ms and hides the bug.
- **Orphaned uploads.** `POST /api/files` creates the row and the bytes
  immediately; forms that store the returned uuid in component state leak a file
  row + object whenever the user abandons, replaces or removes without saving.
  There is no cleanup path anywhere in the codebase.
- **Prettier reformat noise inside in-scope files.** `npm run format` rewrites
  whole untouched methods (file.controller.ts, company.dao.ts), which buries the
  real change. Read the file, not just the diff.
- **`GET /api/companies/:uuid` is `authenticate`-only** (no superAdmin gate, no
  tenant scoping) while the rest of that router is superAdmin-only. Every field
  added to `CompanyDAO.mapToInterface` becomes cross-tenant readable by any
  logged-in user. Verified live 2026-08-12.
- **Clipboard in puppeteer.** `overridePermissions` turns the origin into an
  allow-list, and puppeteer maps BOTH `clipboard-read` and `clipboard-write` to
  CDP `clipboardReadWrite` — but Chrome checks `clipboardSanitizedWrite` for
  `navigator.clipboard.writeText`. Grant `['clipboard-read',
  'clipboard-sanitized-write']` and use a real `page.click` (user activation).
  Source of truth: `puppeteer-core/lib/cjs/puppeteer/api/Browser.js` permission map.
  A harness that SKIPs a check is not a passing check.
- **`ui/Modal` returns null when closed** (children unmount, state resets) and
  does NOT spread unknown props — a `data-testid` on `<Modal>` disappears silently.
- **Manual/AC evidence is the usual gap, not the code.** Feature work here lands
  type-clean and unit-tested; what goes missing is the spec's manual ACs (local
  run log excerpts, browser click-through, migration replay). Nothing survives the
  session — the scratch DB is dropped and screenshots deleted — so ask for the
  pasted command + output rather than trying to reconstruct it. "Ran on a scratch
  DB" is not evidence (L-014).
- **400 vs 500 for DTO throws.** `error.middleware` falls back to 500 unless
  `err.statusCode`/`req.statusCode` is set, and controllers' `fail()` helpers often
  just `next(err)`. Before calling a 400 test wrong, look for a `validated()`
  wrapper (countdown-document.controller.ts:99) that converts any DTO throw —
  constructor or `build()` — into a 400 service error.
- **`repos/modules/*` has no `.prettierrc`.** Every file in the countdown app
  fails `prettier --check` under the defaults (the code is written at ~100 cols).
  Not a finding against a change; do not report it as formatting drift.
- **Knex Proxy guards only see the callable.** A `new Proxy(knexInstance)` with an
  `apply` trap inspecting `args[0]` catches `knex("table")` and nothing else.
  Empirically bypassed: `.join/.leftJoin(...)`, `.from()`, `.into()`, `.table()`,
  `.queryBuilder().from()`, `withSchema()`, object-alias `knex({a:"table"})`,
  space-alias `"table t"`, uppercase names, and `knex.raw`. Never accept a
  "a missed call site fails loudly" claim on such a guard without running the
  bypass list yourself.
  Update after the T1 fix round: the `get`-trap now wraps instance-level
  `from`/`table`/`into`, and that widening is safe (verified against real knex —
  `fn.now`, `raw`, `ref`, `schema`, `client`, aliases, live queries, callback
  transactions all still work). The remaining live bypass nobody documents is
  **`knex.transaction()` with no callback**: the returned `trx` is handed back
  unguarded. Check the bypass list against the *current* trap, not the last one.
- **`knex<IRow>("table")` hides from naive greps.** Any scan for cross-boundary
  table access must allow an optional generic between the callee and the paren
  (`/\b(?:knex|trx)\s*(?:<[^>(]*>)?\(\s*"(\w+)"/`). One real cross-database call
  site was missed by a codemod for exactly this reason.
- **Guards that throw only outside production hide in this repo's test suite.**
  Every DAO unit test `jest.mock`s the database module, so a runtime guard is
  never exercised by `npm test`; a guard-triggered regression is invisible until
  someone runs the API locally. Probe the DAO method directly against a real DB.
- **Fire-and-forget schedulers claim the day before doing the work.**
  `countdown-reminders.service.runDailyOnce()` inserts the `reminder_runs` claim
  first; anything that throws afterwards burns that day with a single
  `console.error`. Any new failure mode in `run()` is a silent daily outage.
- **`knexfile.js` beats `knexfile.ts` in the knex CLI.** `bin/cli.js` calls
  `findUpConfig(cwd,'knexfile',['js','mjs','coffee','ts',…])` in that order, so a
  bare `npx knex migrate:latest` (no `--knexfile`) loads the stale committed
  `knexfile.js` build artefact. Every npm script passes `--knexfile knexfile.ts`;
  the hazard is ad-hoc CLI use on the box. Verified in node_modules 2026-08-14.
- **Seven files in mobius-api are CRLF** (`knex.mock.ts`, `foreignKeyResolver.ts`,
  `box-type/consumable-stock/consumable-type/product-type/tooling-stock.dao.ts`).
  Prettier rewrites them to LF, so `git diff` shows a whole-file rewrite and hides
  the real change. Review them with `diff <(git show HEAD:f | tr -d '\r') f`.
- **Numeric DTO helpers coerce with `Number()`.** `toAmountCents`,
  `toRecurrenceCount`, `toReminderDays` all accept `true` → 1 and `[]` → 0. It is
  the house pattern, so it is a nit, not a new defect — but say so rather than
  silently passing it.
