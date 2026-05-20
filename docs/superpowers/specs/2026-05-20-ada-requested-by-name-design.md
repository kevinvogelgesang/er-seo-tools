# ADA Audit — Operator "Requested by" Name

**Date:** 2026-05-20  
**Status:** Draft  
**PR:** 3 of the ADA audit UX overhaul

## Goal

Capture the operator's first name at login and surface it as a "Requested by" column in the Recent Page Audits and Recent Site Audits history tables. A plain-text cookie — `er-operator-name` — is written by the login route on successful authentication and is read server-side whenever a new audit is created. No user accounts, no permissions, no profile UI: just enough attribution for the team to see who kicked off a run without opening server logs.

## Why now

The audit history tables have become the team's primary daily view of active work. As audits run across multiple clients there is currently no way to tell at a glance who requested a given run. The login screen is the natural capture point — every session authenticates through it already, so a one-time name field costs a single extra input the first time an operator logs in on a new machine.

## Non-goals

- Not a real auth/user system. The name is a free-text cookie: no user table, no uniqueness enforcement, no validation beyond a length cap and whitespace trim.
- Name is only shown in Recent Audits for now. It does not appear in audit detail pages, share views, or exports.
- No per-user permissions or "my audits" filtering.
- No rename UI. To correct a typo an operator clears `er-operator-name` via dev tools and re-authenticates.
- No propagation to child `AdaAudit` rows. The parent `SiteAudit` row is what appears in "Recent Site Audits"; child rows are never shown in a history table.

## Cookie design

| Attribute | Value | Rationale |
|-----------|-------|-----------|
| Name | `er-operator-name` | Hyphen convention matches `er-theme`; distinct from `er_auth` (underscores), a signed credential. |
| HttpOnly | `false` | Not a credential. JS-readable costs nothing and leaves the door open for future client-side use. The server reads it at audit creation regardless. |
| SameSite | `lax` | Matches the auth cookie. Blocks cross-site writes. |
| Secure | Production only | Matches the auth cookie. |
| Path | `/` | Site-wide. |
| Max-Age | `31536000` (1 year) | The auth cookie expires every 12 hours so operators re-authenticate daily; a 1-year name cookie means the field is entered once per machine. |

The cookie value is the raw sanitized name string. No signing needed — it has no security significance.

## Login screen change

**Location:** Above the password field. "Who are you" precedes "prove it."

**Label / placeholder:** `Your name` / `e.g. Kevin`

**Required:** Optional. An empty submission **deletes** any existing `er-operator-name` cookie (via `response.cookies.delete('er-operator-name')`). Audits created without a cookie store `requestedBy = null` and display `—` in the history table. Rationale: the login route only acts on the response it sends; if it omits the cookie entirely on empty input, any stale value from a prior login survives — that is the wrong default for "operator removed their name."

**Validation:** `maxLength={64}` on the input (TSX camelCase, not the HTML lowercase form). Server-side: trim whitespace, enforce 64-char cap via `.slice(0, 64)`, discard if empty after trim. The sanitized value goes into the cookie; the cookie value is trusted as-is at audit creation.

**Pre-fill on re-login:** The login page (`app/login/page.tsx`) is a Next.js 15 Server Component. Read the existing `er-operator-name` cookie via `next/headers` `cookies()` at render time and set it as the input's `defaultValue`. Since the auth cookie expires every 12 hours, operators re-authenticate daily — pre-filling avoids retyping the name each session.

**Login form POST:** Add `<input type="text" name="operatorName" maxLength={64} defaultValue={existingName}>` to the existing `<form action="/api/auth/login" method="post">`. The route handler already calls `request.formData()` — one `formData.get('operatorName')` call, then either `response.cookies.set({ name: 'er-operator-name', value: sanitized, ... })` when non-empty after sanitization, OR `response.cookies.delete('er-operator-name')` when empty.

**On wrong password:** The redirect to `/login?error=invalid` does not carry the name as a query param. The existing cookie (if set from a prior successful login) pre-fills the field on re-render automatically.

## Schema change

**Which models.** `SiteAudit` gets `requestedBy` because it is the parent row shown in "Recent Site Audits." Standalone `AdaAudit` rows (where `siteAuditId IS NULL`) get it because they appear in "Recent Page Audits." Child `AdaAudit` rows (`siteAuditId IS NOT NULL`) are never shown in any history list and do not receive the column.

**Column definition in `prisma/schema.prisma`:**

```prisma
// AdaAudit model — add:
requestedBy   String?   // null on child rows; set on standalone page audits

// SiteAudit model — add:
requestedBy   String?   // operator name from er-operator-name cookie at creation time
```

**Index:** No. The column is only `SELECT`-ed via existing paginated `findMany` calls, never filtered or sorted by name.

**Migration name:** `add_requested_by`

Prisma generates `ALTER TABLE ... ADD COLUMN "requestedBy" TEXT` for both tables (nullable additions use `ALTER TABLE` directly, not the redefine-table pattern). Append the backfill UPDATE statements manually to the generated migration file before committing — matching the hand-written SQL convention in `20260513213622_add_audit_batches/migration.sql`:

```sql
-- Backfill: mark all pre-feature audits as "Testing"
UPDATE "SiteAudit" SET "requestedBy" = 'Testing' WHERE "requestedBy" IS NULL;
UPDATE "AdaAudit"  SET "requestedBy" = 'Testing'
  WHERE "requestedBy" IS NULL AND "siteAuditId" IS NULL;
```

Child `AdaAudit` rows (`siteAuditId IS NOT NULL`) are intentionally excluded.

## Wiring

### Standalone page audit — POST /api/ada-audit

Read the cookie inline and pass to `prisma.adaAudit.create`. No new helpers needed.

```ts
const requestedBy = request.cookies.get('er-operator-name')?.value?.trim().slice(0, 64) || null
const audit = await prisma.adaAudit.create({
  data: { url: parsed.toString(), status: 'pending', clientId, wcagLevel, requestedBy },
})
```

### Site audit — POST /api/site-audit → queueSiteAuditRequest → enqueueAudit

Thread `requestedBy` through the existing call chain:

1. `app/api/site-audit/route.ts` — read cookie; add `requestedBy` to the `QueueRequestInput` object.
2. `lib/ada-audit/queue-request.ts` — add `requestedBy?: string | null` to `QueueRequestInput`; forward to `enqueueAudit`.
3. `lib/ada-audit/queue-manager.ts` — `enqueueAudit` currently takes `preDiscoveredUrls` as the fourth positional argument and tests assert that contract. To avoid breaking the contract, **refactor `enqueueAudit` to take an options object** for the optional fields: `enqueueAudit(domain, clientId, wcagLevel, { preDiscoveredUrls?, requestedBy? })`. Update the one existing caller (`queue-request.ts`) and tests in the same migration. This keeps positional parameters stable for the required args and avoids fragile ordering for the optional ones.

Child `AdaAudit` rows created inside `runAudit` receive no `requestedBy` — the column stays `NULL` on those rows by design.

**Bulk-queue (`POST /api/site-audit/bulk-queue`):** Extend the handler to accept `NextRequest` and read `request.cookies.get('er-operator-name')`. Same-origin fetches from `BulkQueueModal` send cookies by default. Forward `requestedBy` through to every audit row created by the bulk operation. The previous spec rationale was wrong — this is straightforward and worth doing.

### Recent Audits list responses

`GET /api/ada-audit` and `GET /api/site-audit` map DB rows in `items.map`. Add `requestedBy: a.requestedBy ?? null` to each transform. Extend the TypeScript interfaces in `lib/ada-audit/types.ts`:

```ts
// AuditListItem
requestedBy: string | null

// SiteAuditDetail
requestedBy: string | null
```

**Important:** `SiteAuditDetail` is shared by both `GET /api/site-audit` (list) and `GET /api/site-audit/[id]` (detail). Adding `requestedBy` as a required field on the type means **both** endpoints must return it. Update the detail endpoint at `app/api/site-audit/[id]/route.ts` to include `requestedBy: audit.requestedBy ?? null` in its response object. Otherwise the type contract breaks at the detail endpoint.

## UI display

**Column label:** `Requested by`

**Position:**

- `AuditHistory`: after `Client` — `URL | Client | Requested by | Score | Issues | Status | Date | Actions`
- `SiteAuditHistory`: after `Client` — `Domain | Client | Requested by | Pages | Score | Violations | Status | Date | Actions`

Grouping "Client" (org) and "Requested by" (person) adjacently is logical.

**Cell:**

```tsx
<td className="py-2.5 pr-4 text-navy/60 dark:text-white/60 whitespace-nowrap">
  {a.requestedBy ?? <span className="text-navy/25 dark:text-white/25">—</span>}
</td>
```

Backfilled historical rows render the literal string `Testing`. New rows without a name cookie render `—`, consistent with how the `Client` column handles unset values and clearly distinguishing "new audit, no name supplied" from "historical audit predating this feature."

## File structure

| File | Status | Role |
|------|--------|------|
| `prisma/schema.prisma` | Modify | Add `requestedBy String?` to `AdaAudit` and `SiteAudit` |
| `prisma/migrations/<ts>_add_requested_by/migration.sql` | Create | `ALTER TABLE ... ADD COLUMN` for both tables + backfill UPDATEs appended manually |
| `lib/auth.ts` | Modify | Export `OPERATOR_NAME_COOKIE_NAME = 'er-operator-name'` and `OPERATOR_NAME_MAX_AGE = 31536000` |
| `app/login/page.tsx` | Modify | Name input above password; `defaultValue` pre-filled from cookie via `next/headers` |
| `app/api/auth/login/route.ts` | Modify | Read + sanitize `operatorName` from `formData`; set `er-operator-name` cookie on success |
| `lib/ada-audit/types.ts` | Modify | Add `requestedBy: string \| null` to `AuditListItem` and `SiteAuditDetail` |
| `lib/ada-audit/queue-request.ts` | Modify | Add `requestedBy?: string \| null` to `QueueRequestInput`; thread to `enqueueAudit` |
| `lib/ada-audit/queue-manager.ts` | Modify | Add `requestedBy` param to `enqueueAudit`; include in `prisma.siteAudit.create` |
| `app/api/ada-audit/route.ts` | Modify | POST: read cookie → create; GET: include `requestedBy` in `items.map` |
| `app/api/site-audit/route.ts` | Modify | POST: read cookie → `queueSiteAuditRequest`; GET: include `requestedBy` in `items.map` |
| `components/ada-audit/AuditHistory.tsx` | Modify | Add `Requested by` column header and cell |
| `components/ada-audit/SiteAuditHistory.tsx` | Modify | Add `Requested by` column header and cell |

## Edge cases

**No name entered at login.** Cookie not set. New audits store `null`. History displays `—`.

**Operator corrects a typo.** Clears cookie via dev tools and re-authenticates (auth expires every 12 hours, so at most a session wait). Past records are unchanged.

**Multiple operators sharing a machine.** Last login overwrites the cookie. Expected behavior for a shared workstation.

**Bulk-queued audits.** The bulk-queue handler is updated in this PR to accept `NextRequest` and read the operator-name cookie. Bulk-queued audits store `requestedBy` from the calling operator just like single-audit requests do.

**Empty string after trim.** `?.value?.trim().slice(0, 64) || null` coerces to `null`. Not written to cookie or DB.

**Site audit child rows.** Created inside `runAudit` without `requestedBy`; column stays `NULL`. These rows never appear in a history list.

## Tests

| Test | File |
|------|------|
| `POST /api/auth/login` sets `er-operator-name` cookie when `operatorName` is non-empty | `app/api/auth/login/route.test.ts` (new) |
| `POST /api/auth/login` does not set cookie when `operatorName` is empty or absent | same |
| `POST /api/auth/login` trims and caps name at 64 chars | same |
| `POST /api/ada-audit` stores `requestedBy` from cookie on created row | `app/api/ada-audit/route.test.ts` (new) |
| `POST /api/ada-audit` stores `null` when cookie is absent | same |
| `GET /api/ada-audit` includes `requestedBy` in each list item | same |
| `POST /api/site-audit` passes `requestedBy` through to `queueSiteAuditRequest` | `app/api/site-audit/route.test.ts` (new) |
| `GET /api/site-audit` includes `requestedBy` in each list item | same |
| `enqueueAudit` persists `requestedBy` on the `SiteAudit` row | `lib/ada-audit/queue-manager.test.ts` (extend existing) |

## Ambiguities resolved unilaterally

1. **Empty-state for new post-feature audits with no name cookie.** Display `—` (em dash) rather than `"Testing"`. Rationale: `"Testing"` as a backfill string means "this record predates the feature." A new nameless audit is a different condition — operator simply skipped the field. Consistent with how the `Client` column handles unset values.

2. **Child rows excluded.** Only `siteAuditId IS NULL` `AdaAudit` rows get `requestedBy`. Child rows (`siteAuditId IS NOT NULL`) are never surfaced in a history list.

3. **Cookie HttpOnly = false.** The auth cookie is `HttpOnly: true` (signed credential). The name cookie is purely cosmetic — no security value in protecting it from JS.

4. **Bulk-queue is updated to read the cookie.** The handler accepts `NextRequest` in this PR. Same-origin fetch from `BulkQueueModal` sends cookies; bulk-queued audits carry `requestedBy` just like individual requests.
