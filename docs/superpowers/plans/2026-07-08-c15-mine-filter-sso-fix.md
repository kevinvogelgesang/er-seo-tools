# C15 — "Mine" Filter SSO Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Site audits (and seoOnly scans) created under Google SSO get a non-null, session-derived `requestedBy` so the "Mine" recents filter matches them again.

**Architecture:** One-line derivation swap in two API routes. `app/api/site-audit/route.ts` and `app/api/site-audit/bulk-queue/route.ts` currently compute `requestedBy = sanitizeOperatorName(er-operator-name cookie)` — a cookie only the legacy password login sets, so SSO-created site audits store `null` (and a stale legacy cookie can misattribute). Both routes switch to `getOperatorLabel(authCookie, operatorCookie)` (`lib/auth.ts:84-96` region), exactly like `app/api/ada-audit/route.ts:56-59`. The read side (`lib/ada-audit/recents-query.ts`) already compares against `getOperatorLabel` — no change. No backfill, no migration, no UI change.

**Tech Stack:** Next.js 15 App Router route handlers, Vitest (DB-backed for `route.test.ts`, mock-based for `bulk-queue/route.test.ts`), `lib/auth.ts` helpers.

**Spec:** `../specs/2026-07-08-audit-consolidation-batch-design.md` (PR0 section — Codex-reviewed ×12; fix #1 shapes the test matrix below).

## Resolved decisions

- **No backfill** (Kevin, 2026-07-08): post-SSO null rows carry no identity; pre-SSO typed names can't be mapped to Google display names. "Mine" heals forward.
- **Scheduled audits keep `'scheduled'`** (`lib/jobs/handlers/scheduled-site-audit.ts:116`) — untouched.
- **Four-branch coverage** (Codex fix #1): `getOperatorLabel`'s own branches are already unit-tested in `lib/auth.test.ts:169-183`. The route tests prove the ROUTES now go through it — including the legacy-cookie fallback ("no session" does NOT mean null) and the stale-cookie misattribution cure (session wins over a conflicting legacy cookie).

## Global Constraints

- Array-form `$transaction([...])` only (not applicable here — no transactions touched).
- Tests run DB-backed against the local SQLite: `DATABASE_URL="file:./local-dev.db" npm test`.
- No jest-dom in this repo; route tests assert on `Response` status/json and Prisma rows.
- Cookie signing in tests: `createAuthCookieValue()` works without env setup (`getSigningSecret()` has a non-production fallback) — the existing D7 notify tests in `app/api/site-audit/route.test.ts:97-127` are the pattern.
- Gates before PR: `npx tsc --noEmit` · `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build`.
- Branch: `fix/c15-mine-filter-sso` off current `main`; PR per house flow.

## File Structure

- Modify: `app/api/site-audit/route.ts` (import swap + `requestedBy` derivation, lines 6 + 34)
- Modify: `app/api/site-audit/bulk-queue/route.ts` (import swap + `requestedBy` derivation, lines 12 + 17)
- Modify (tests): `app/api/site-audit/route.test.ts` (new describe block, DB-backed)
- Modify (tests): `app/api/site-audit/bulk-queue/route.test.ts` (new tests, mock-based)

---

### Task 0: Branch

- [ ] **Step 1: Create the branch**

```bash
cd /Users/kevin/enrollment-resources/Claude/er-seo-tools
git checkout main && git pull && git checkout -b fix/c15-mine-filter-sso
```

---

### Task 1: `POST /api/site-audit` derives `requestedBy` from the SSO session

**Files:**
- Modify: `app/api/site-audit/route.ts:6,34`
- Test: `app/api/site-audit/route.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `getOperatorLabel(authCookieValue, operatorCookieValue): Promise<string | null>` from `@/lib/auth` (existing).
- Produces: `SiteAudit.requestedBy` = session name → session email → sanitized legacy cookie → null. Task 2 mirrors the same derivation.

- [ ] **Step 1: Write the failing tests**

Append to `app/api/site-audit/route.test.ts` (alongside the existing D7 describe block; reuse its conventions — the file already imports `createAuthCookieValue`, `AUTH_COOKIE_NAME`, `prisma`, `POST`, `NextRequest`). Add `OPERATOR_NAME_COOKIE_NAME` to the existing `@/lib/auth` import line.

```ts
describe('POST /api/site-audit — requestedBy attribution (C15)', () => {
  const RB_PREFIX = 'c15rb-'

  async function clearRb() {
    await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: RB_PREFIX } } })
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: RB_PREFIX } } })
  }
  beforeAll(clearRb)
  afterAll(clearRb)

  async function postWithCookies(domain: string, opts: { session?: string; operator?: string }): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const cookies: string[] = []
    if (opts.session) cookies.push(`${AUTH_COOKIE_NAME}=${opts.session}`)
    if (opts.operator) cookies.push(`${OPERATOR_NAME_COOKIE_NAME}=${opts.operator}`)
    if (cookies.length) headers.cookie = cookies.join('; ')
    return POST(new NextRequest('http://localhost/api/site-audit', { method: 'POST', headers, body: JSON.stringify({ domain }) }))
  }

  it('stamps the verified session name — even when a stale legacy cookie disagrees', async () => {
    const session = await createAuthCookieValue({ sub: 'google:1', email: 'kevin@enrollmentresources.com', hd: 'enrollmentresources.com', name: 'Kevin Vogelgesang' })
    const res = await postWithCookies(`${RB_PREFIX}name.example`, { session, operator: 'Stale Old Name' })
    expect(res.status).toBe(202)
    const { id } = await res.json()
    const row = await prisma.siteAudit.findUnique({ where: { id } })
    expect(row?.requestedBy).toBe('Kevin Vogelgesang')
  })

  it('falls back to the session email when the session has no name', async () => {
    const session = await createAuthCookieValue({ sub: 'google:2', email: 'op@enrollmentresources.com', hd: 'enrollmentresources.com', name: null })
    const res = await postWithCookies(`${RB_PREFIX}email.example`, { session })
    const { id } = await res.json()
    const row = await prisma.siteAudit.findUnique({ where: { id } })
    expect(row?.requestedBy).toBe('op@enrollmentresources.com')
  })

  it('falls back to the sanitized legacy cookie when there is no session', async () => {
    const res = await postWithCookies(`${RB_PREFIX}legacy.example`, { operator: '  Kevin  ' })
    const { id } = await res.json()
    const row = await prisma.siteAudit.findUnique({ where: { id } })
    expect(row?.requestedBy).toBe('Kevin')
  })

  it('stores null when neither cookie is present', async () => {
    const res = await postWithCookies(`${RB_PREFIX}anon.example`, {})
    const { id } = await res.json()
    const row = await prisma.siteAudit.findUnique({ where: { id } })
    expect(row?.requestedBy).toBeNull()
  })
})
```

Note: `beforeAll`/`afterAll` are already imported in this file. If the queue rejects same-domain duplicates across tests, the distinct `RB_PREFIX` domains per test avoid it (mirrors the D7 block).

- [ ] **Step 2: Run tests to verify the first one fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/site-audit/route.test.ts`
Expected: the "stamps the verified session name" and "falls back to the session email" tests FAIL (`requestedBy` is `'Stale Old Name'` / `null` under the current legacy-cookie derivation); the legacy-cookie and null tests may already pass.

- [ ] **Step 3: Implement the derivation swap**

In `app/api/site-audit/route.ts`, change the import (line 6):

```ts
import { OPERATOR_NAME_COOKIE_NAME, AUTH_COOKIE_NAME, getAuthSession, getOperatorLabel } from '@/lib/auth'
```

and the derivation (line 34):

```ts
  const requestedBy = await getOperatorLabel(
    request.cookies.get(AUTH_COOKIE_NAME)?.value,
    request.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value,
  )
```

(`sanitizeOperatorName` is no longer imported; the separate `getAuthSession` call for D7's `notifyEmail` stays as-is — a second HMAC verification is trivially cheap and keeps the two concerns independent.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/site-audit/route.test.ts`
Expected: PASS (all pre-existing tests in the file stay green).

- [ ] **Step 5: Commit**

```bash
git add app/api/site-audit/route.ts app/api/site-audit/route.test.ts
git commit -m "fix(site-audit): derive requestedBy via SSO-aware getOperatorLabel (C15)"
```

---

### Task 2: `POST /api/site-audit/bulk-queue` derives `requestedBy` the same way

**Files:**
- Modify: `app/api/site-audit/bulk-queue/route.ts:12,17`
- Test: `app/api/site-audit/bulk-queue/route.test.ts` (append tests)

**Interfaces:**
- Consumes: `getOperatorLabel` from `@/lib/auth` (same as Task 1).
- Produces: every `queueSiteAuditRequest` call in the bulk loop carries the session-derived `requestedBy`.

- [ ] **Step 1: Write the failing tests**

Append to `app/api/site-audit/bulk-queue/route.test.ts`. This file is mock-based (`prisma` + `queueSiteAuditRequest` mocked; `@/lib/auth` runs REAL — do not mock it). Extend the imports at the top of the file:

```ts
import { createAuthCookieValue, AUTH_COOKIE_NAME, OPERATOR_NAME_COOKIE_NAME } from '@/lib/auth'
```

and add a request builder + tests:

```ts
function reqWithCookies(opts: { session?: string; operator?: string }) {
  const headers = new Headers()
  const cookies: string[] = []
  if (opts.session) cookies.push(`${AUTH_COOKIE_NAME}=${opts.session}`)
  if (opts.operator) cookies.push(`${OPERATOR_NAME_COOKIE_NAME}=${opts.operator}`)
  if (cookies.length) headers.set('cookie', cookies.join('; '))
  return new NextRequest('http://localhost/api/site-audit/bulk-queue', { method: 'POST', headers })
}

describe('POST /api/site-audit/bulk-queue — requestedBy attribution (C15)', () => {
  it('passes the verified session name to every queue request, beating a stale legacy cookie', async () => {
    vi.mocked(prisma.client.findMany).mockResolvedValue([
      { id: 1, name: 'A', domains: JSON.stringify(['a.example']) },
    ] as never)
    vi.mocked(queueSiteAuditRequest).mockResolvedValue({ kind: 'queued', id: 'audit-1' })

    const session = await createAuthCookieValue({ sub: 'google:1', email: 'kevin@enrollmentresources.com', hd: 'enrollmentresources.com', name: 'Kevin Vogelgesang' })
    const res = await POST(reqWithCookies({ session, operator: 'Stale Old Name' }))
    expect(res.status).toBe(200)
    expect(queueSiteAuditRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestedBy: 'Kevin Vogelgesang' }),
    )
  })

  it('falls back to the sanitized legacy cookie without a session, and null with neither', async () => {
    vi.mocked(prisma.client.findMany).mockResolvedValue([
      { id: 1, name: 'A', domains: JSON.stringify(['a.example']) },
    ] as never)
    vi.mocked(queueSiteAuditRequest).mockResolvedValue({ kind: 'queued', id: 'audit-1' })

    await POST(reqWithCookies({ operator: '  Kevin  ' }))
    expect(queueSiteAuditRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestedBy: 'Kevin' }),
    )

    await POST(reqWithCookies({}))
    expect(queueSiteAuditRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestedBy: null }),
    )
  })
})
```

- [ ] **Step 2: Run tests to verify the first one fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/site-audit/bulk-queue/route.test.ts`
Expected: the session test FAILS (`requestedBy: 'Stale Old Name'` under current code); the fallback/null assertions already pass (legacy path unchanged).

- [ ] **Step 3: Implement the derivation swap**

In `app/api/site-audit/bulk-queue/route.ts`, change the import (line 12):

```ts
import { OPERATOR_NAME_COOKIE_NAME, AUTH_COOKIE_NAME, getOperatorLabel } from '@/lib/auth'
```

and the derivation (line 17):

```ts
  const requestedBy = await getOperatorLabel(
    request.cookies.get(AUTH_COOKIE_NAME)?.value,
    request.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value,
  )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/site-audit/bulk-queue/route.test.ts`
Expected: PASS (all pre-existing tests stay green).

- [ ] **Step 5: Commit**

```bash
git add app/api/site-audit/bulk-queue/route.ts app/api/site-audit/bulk-queue/route.test.ts
git commit -m "fix(site-audit): bulk-queue requestedBy via SSO-aware getOperatorLabel (C15)"
```

---

### Task 3: Gates, PR, ship

- [ ] **Step 1: Confirm no other writer remains on the legacy-only path**

Run: `grep -rn "sanitizeOperatorName" app lib --include="*.ts" | grep -v test | grep -v "lib/auth.ts"`
Expected: only `app/api/auth/login/route.ts` (the password login that WRITES the cookie) remains. Any other hit is an unconverted writer — stop and convert it the same way.

- [ ] **Step 2: Full gates**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```

Expected: tsc clean · full suite green (≥3780 tests) · build compiles.

- [ ] **Step 3: PR + merge + deploy per house flow**

```bash
git push -u origin fix/c15-mine-filter-sso
gh pr create --title "fix(site-audit): Mine filter SSO regression — requestedBy via getOperatorLabel (C15)" --body "..."
```

Merge when gate-green (standing authorization), deploy `ssh seo@144.126.213.242 "~/deploy.sh"` (code-only, no migration), post-deploy verify `/api/health` + a fresh authed site audit shows under "Mine" (Kevin eyeball, cookie-gated).

- [ ] **Step 4: Docs ritual**

Tracker C15 → `[x]` + status-log line; rewrite `HANDOFF-improvement-roadmap.md` (next item = C16 plan) in the same commit; end the session reply with the paste-in prompt.
