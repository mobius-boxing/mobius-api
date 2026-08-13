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
- **Numeric DTO helpers coerce with `Number()`.** `toAmountCents`,
  `toRecurrenceCount`, `toReminderDays` all accept `true` → 1 and `[]` → 0. It is
  the house pattern, so it is a nit, not a new defect — but say so rather than
  silently passing it.
