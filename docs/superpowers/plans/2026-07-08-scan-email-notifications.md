# D7 — Scan-completion Email Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an operator ticks "Email me when this finishes" on a site-audit request, send them one email when the audit's post-scan SEO analysis completes (or notify the admin if it failed) — via Mailgun, dark-by-default, through the durable job queue.

**Architecture:** An additive nullable `SiteAudit.notifyEmail` (stamped server-side from the verified auth session at request time) plus two durable sent-markers. A new `lib/notify/` module (injectable-deps Mailgun HTTP transport + pure content builders). A durable `notify-email` job resolves recipient + content from the row at send time and is idempotent via a marker check. Send seams: the end of `runBrokenLinkVerify` + its `onExhausted` (complete kind), and `failSiteAudit` (failed kind → admin). Dark-by-default: `MAILGUN_API_KEY`/`MAILGUN_DOMAIN` unset → checkbox hidden + hooks no-op.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, the in-process durable job queue (`lib/jobs/`), Mailgun Messages API over plain `fetch` (no SDK/SMTP lib), Vitest.

## Global Constraints

Copied from the spec + repo invariants. Every task implicitly includes these.

- **Array-form `$transaction([...])` ONLY** — never interactive `$transaction(async tx => …)`. Express conditionals as SQL/`updateMany` predicates.
- **Raw SQL sets `updatedAt` manually** (`Date.now()`, integer ms) — not applicable here (no raw SQL), but no new raw SQL either.
- **SQLite migration is hand-authored** when `migrate dev` can't run non-interactively: write `prisma/migrations/<timestamp>_<name>/migration.sql` by hand, apply with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy` then `DATABASE_URL="file:./local-dev.db" npx prisma generate`.
- **No `createMany` + `skipDuplicates`** (SQLite); per-row create with P2002 catch if ever needed (not needed here).
- **Findings-hook rule:** a notify failure must NEVER touch the audit/builder. Hooks either `void …().catch(log)` or `await …` inside a `try/catch` that logs-and-swallows.
- **Dark-by-default:** `MAILGUN_API_KEY` OR `MAILGUN_DOMAIN` unset ⇒ feature off. Do NOT add either to `instrumentation.ts` fail-fast gates.
- **Share/deep-link URLs use `NEXT_PUBLIC_APP_URL`**, never request origin.
- **Never rely on `Class.name`/identifier names at runtime** (SWC minifies) — use explicit string literals.
- **Secrets:** NEVER log `MAILGUN_API_KEY`. Truncate any Mailgun error body before logging.
- **Tests:** transport is fully mocked everywhere. Repo has NO jest-dom — use `.getAttribute()`/`.toBeTruthy()`/`queryByText(...) === null`. Component tests: first line `// @vitest-environment jsdom`. DB tests: prefix `DATABASE_URL="file:./local-dev.db"`.
- **Env var read in exactly one module** (`lib/notify/config.ts`) with inline defaults.

## Resolved decisions (from the spec — Kevin, do not re-litigate)

1. **D1 Scope:** site audits only (ADA, seoIntent, seoOnly). Standalone ADA + report renders do NOT notify in v1.
2. **D2 Recipient:** the requester, resolved SERVER-SIDE from the verified Google-OAuth session email (`getAuthSession`). Client-supplied address is IGNORED.
3. **D3 Failures → admin** (`NOTIFY_ADMIN_EMAIL`, default = sender), only for audits that had notify requested.
4. **D4 Timing:** email fires after the post-audit SEO analysis completes (end of `runBrokenLinkVerify`); verify-job `onExhausted` still sends the completion email.
5. **D5 Opt-in per scan:** checkbox on BOTH `SiteAuditForm` + `SeoScanForm`, ALWAYS unchecked on load (no localStorage), hidden when no session email exists.
6. **D6 Schedules stay silent** — `scheduled-site-audit` + bulk-queue never set `notifyEmail`.
7. **D7 Sender identity:** `From = NOTIFY_FROM` (default `kevin@enrollmentresources.com`); `NOTIFY_REPLY_TO` (default Kevin) is the alignment escape hatch (sending domain is `mg.enrollment.email`, which does NOT DMARC-align with the From org domain — see spec §Transport).

## Idempotency model (Codex review fix #1 — the real guard)

Job `dedupKey` is **active-window only** (`jobs_active_dedup` partial unique index `WHERE status IN ('queued','running')`, verified in `lib/jobs/queue.ts`). A *completed* notify job does NOT stop a recovery replay from enqueuing a twin. So the correctness guard is the durable sent-marker, and the handler flow is:

1. Read the row. No-op (return) if: row deleted; `notifyEmail` null (complete kind) / no admin recipient (failed kind); relevant sent-marker already non-null; or Mailgun env unset (dark).
2. Send the email (await transport).
3. On success, stamp the marker (`updateMany` conditional on the marker still being null).

This is **at-least-once with a narrow duplicate window** (a crash landing between step 2 and step 3 re-sends on retry) — chosen over stamp-first (which would silently drop on transient transport failure and defeat the 3-attempt retry). A rare duplicate "your audit finished" email is harmless; a dropped one is worse. `dedupKey notify:<id>:<kind>` stays as cheap in-flight dedup, not the guarantee.

## File Structure

**Create:**
- `prisma/migrations/20260708120000_scan_email_notifications/migration.sql` — 3 nullable columns on `SiteAudit`.
- `lib/notify/config.ts` — single env-reading module: `isNotifyEnabled()`, `mailgunConfig()`, `notifyFrom()`, `notifyReplyTo()`, `notifyAdminEmail()`.
- `lib/notify/transport.ts` — injectable-deps Mailgun HTTP transport (`realNotifyDeps`, `sendEmail`).
- `lib/notify/transport.test.ts`
- `lib/notify/content.ts` — pure content builders (`buildCompleteEmail`, `buildFailedEmail`).
- `lib/notify/content.test.ts`
- `lib/jobs/handlers/notify-email.ts` — durable handler + `enqueueNotifyEmail`.
- `lib/jobs/handlers/notify-email.test.ts`

**Modify:**
- `prisma/schema.prisma` — `SiteAudit` model: 3 new fields.
- `lib/ada-audit/queue-request.ts` — `QueueRequestInput.notifyEmail`; thread to `enqueueAudit`.
- `lib/ada-audit/queue-manager.ts` — `EnqueueAuditOptions.notifyEmail`; `create` data; `failSiteAudit` failed-notify enqueue.
- `app/api/site-audit/route.ts` — read auth session, stamp `notifyEmail`.
- `app/api/site-audit/route.test.ts` — stamping tests.
- `lib/jobs/handlers/broken-link-verify.ts` — complete-notify at end of `runBrokenLinkVerify` + in `onBrokenLinkVerifyExhausted`; add `notifyEmail`/`notifyCompleteSentAt` to the `site` select.
- `lib/jobs/handlers/register.ts` — register the new handler.
- `components/ada-audit/SiteAuditForm.tsx` + `.test.tsx` — checkbox + `notifyAvailable` prop + `notify` in POST.
- `components/ada-audit/AuditIndexTabs.tsx` — thread `notifyAvailable`.
- `app/(app)/ada-audit/page.tsx` — derive `notifyAvailable` server-side.
- `components/seo-parser/SeoScanForm.tsx` + `.test.tsx` — checkbox + `notifyAvailable` prop + `notify` in POST.
- `components/seo-parser/SeoAuditTabs.tsx` — thread `notifyAvailable`.
- `app/(app)/seo-audits/page.tsx` — derive `notifyAvailable` server-side.
- `CLAUDE.md` — Key files + Architecture pattern + env note (Task 8).

---

## Task 1: Schema migration — notify columns on SiteAudit

**Files:**
- Modify: `prisma/schema.prisma` (`model SiteAudit`)
- Create: `prisma/migrations/20260708120000_scan_email_notifications/migration.sql`

**Interfaces:**
- Produces: `SiteAudit.notifyEmail String?`, `SiteAudit.notifyCompleteSentAt DateTime?`, `SiteAudit.notifyFailedSentAt DateTime?` (all nullable, all default null).

- [ ] **Step 1: Add the fields to `prisma/schema.prisma`** (in `model SiteAudit`, after `reportGeneratedAt`):

```prisma
  reportGeneratedAt DateTime? // C4: last successful report-render stamp (file under REPORTS_DIR)
  notifyEmail          String?    // D7: recipient (verified session email), stamped at creation when opt-in ticked; null = silent
  notifyCompleteSentAt DateTime?  // D7: durable at-least-once guard for the 'complete' email
  notifyFailedSentAt   DateTime?  // D7: durable at-least-once guard for the 'failed' email
```

- [ ] **Step 2: Hand-author the migration SQL** at `prisma/migrations/20260708120000_scan_email_notifications/migration.sql`:

```sql
-- D7 scan-completion email notifications: additive nullable columns on SiteAudit.
ALTER TABLE "SiteAudit" ADD COLUMN "notifyEmail" TEXT;
ALTER TABLE "SiteAudit" ADD COLUMN "notifyCompleteSentAt" DATETIME;
ALTER TABLE "SiteAudit" ADD COLUMN "notifyFailedSentAt" DATETIME;
```

- [ ] **Step 3: Apply the migration and regenerate the client**

Run:
```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && \
DATABASE_URL="file:./local-dev.db" npx prisma generate
```
Expected: "1 migration applied" (the new one) + "Generated Prisma Client".

- [ ] **Step 4: Verify the client typing picked up the fields**

Run: `npx tsc --noEmit`
Expected: PASS (no errors — the new optional fields are additive).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260708120000_scan_email_notifications
git commit -m "feat(schema): D7 SiteAudit notifyEmail + sent-marker columns"
```

---

## Task 2: Notify config + content builders (pure)

**Files:**
- Create: `lib/notify/config.ts`, `lib/notify/content.ts`, `lib/notify/content.test.ts`

**Interfaces:**
- Produces (`config.ts`):
  - `isNotifyEnabled(): boolean` — `Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN)`
  - `mailgunConfig(): { apiKey: string; domain: string; baseUrl: string } | null` — null when disabled; `baseUrl` from `MAILGUN_API_BASE` (default `https://api.mailgun.net`)
  - `notifyFrom(): string` — `process.env.NOTIFY_FROM ?? 'kevin@enrollmentresources.com'`
  - `notifyReplyTo(): string` — `process.env.NOTIFY_REPLY_TO ?? 'kevin@enrollmentresources.com'`
  - `notifyAdminEmail(): string` — `process.env.NOTIFY_ADMIN_EMAIL ?? notifyFrom()`
- Produces (`content.ts`):
  - `interface EmailContent { subject: string; html: string; text: string }`
  - `interface CompleteInput { domain: string; scanType: string; requestedBy: string | null; adaScore: number | null; seoScore: number | null; durationMs: number | null; resultsUrl: string; seoUnavailable?: boolean }`
  - `buildCompleteEmail(input: CompleteInput): EmailContent`
  - `interface FailedInput { domain: string; requestedBy: string | null; error: string; resultsUrl: string }`
  - `buildFailedEmail(input: FailedInput): EmailContent`

- [ ] **Step 1: Write the failing test** at `lib/notify/content.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildCompleteEmail, buildFailedEmail } from './content'

describe('buildCompleteEmail', () => {
  it('renders subject with domain + scores and links to results', () => {
    const c = buildCompleteEmail({
      domain: 'example.edu', scanType: 'ADA + SEO', requestedBy: 'Kevin',
      adaScore: 88, seoScore: 72, durationMs: 90_000,
      resultsUrl: 'https://app.example/ada-audit/site/abc',
    })
    expect(c.subject).toContain('example.edu')
    expect(c.subject).toContain('88')
    expect(c.subject).toContain('72')
    expect(c.html).toContain('https://app.example/ada-audit/site/abc')
    expect(c.text).toContain('example.edu')
  })

  it('tolerates a missing SEO run (onExhausted path) without rendering a literal 0', () => {
    const c = buildCompleteEmail({
      domain: 'example.edu', scanType: 'ADA', requestedBy: null,
      adaScore: 88, seoScore: null, durationMs: null,
      resultsUrl: 'https://app.example/x', seoUnavailable: true,
    })
    expect(c.text).toContain('SEO analysis unavailable')
    expect(c.subject).not.toMatch(/SEO 0\b/)
  })

  it('escapes HTML-unsafe characters in dynamic strings', () => {
    const c = buildCompleteEmail({
      domain: 'x">&y.edu', scanType: 'SEO', requestedBy: '<b>me</b>',
      adaScore: null, seoScore: 50, durationMs: 1000, resultsUrl: 'https://app.example/x',
    })
    expect(c.html).not.toContain('<b>me</b>')
    expect(c.html).toContain('&lt;b&gt;me&lt;/b&gt;')
  })
})

describe('buildFailedEmail', () => {
  it('includes domain, requester, and the terminal error', () => {
    const c = buildFailedEmail({
      domain: 'example.edu', requestedBy: 'Kevin',
      error: 'Audit timed out', resultsUrl: 'https://app.example/ada-audit/site/abc',
    })
    expect(c.subject.toLowerCase()).toContain('failed')
    expect(c.subject).toContain('example.edu')
    expect(c.text).toContain('Audit timed out')
    expect(c.html).toContain('https://app.example/ada-audit/site/abc')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/notify/content.test.ts`
Expected: FAIL — `Cannot find module './content'`.

- [ ] **Step 3: Implement `lib/notify/config.ts`**

```ts
// lib/notify/config.ts
// Single home for all D7 notify env reads. Dark-by-default gate lives here.
// US region default; MAILGUN_API_BASE overrides for an EU account.

export function isNotifyEnabled(): boolean {
  return Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN)
}

export function mailgunConfig(): { apiKey: string; domain: string; baseUrl: string } | null {
  const apiKey = process.env.MAILGUN_API_KEY
  const domain = process.env.MAILGUN_DOMAIN
  if (!apiKey || !domain) return null
  const baseUrl = (process.env.MAILGUN_API_BASE || 'https://api.mailgun.net').replace(/\/+$/, '')
  return { apiKey, domain, baseUrl }
}

export function notifyFrom(): string {
  return process.env.NOTIFY_FROM || 'kevin@enrollmentresources.com'
}

export function notifyReplyTo(): string {
  return process.env.NOTIFY_REPLY_TO || 'kevin@enrollmentresources.com'
}

export function notifyAdminEmail(): string {
  return process.env.NOTIFY_ADMIN_EMAIL || notifyFrom()
}

export function notifyRequestTimeoutMs(): number {
  return Number(process.env.NOTIFY_REQUEST_TIMEOUT_MS) || 10_000
}
```

_(Codex plan-fix #2: env vars are read in exactly one module — `NOTIFY_REQUEST_TIMEOUT_MS` lives here, not in transport.ts.)_

- [ ] **Step 4: Implement `lib/notify/content.ts`**

```ts
// lib/notify/content.ts
// Pure email content builders. No transport, no env. Every dynamic string is
// HTML-escaped for the html body; the text body is plain.

export interface EmailContent { subject: string; html: string; text: string }

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function fmtScore(n: number | null): string {
  return n == null ? '—' : String(n)
}

function fmtDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

export interface CompleteInput {
  domain: string
  scanType: string
  requestedBy: string | null
  adaScore: number | null
  seoScore: number | null
  durationMs: number | null
  resultsUrl: string
  seoUnavailable?: boolean
}

export function buildCompleteEmail(input: CompleteInput): EmailContent {
  const seoPart = input.seoUnavailable ? 'SEO n/a' : `SEO ${fmtScore(input.seoScore)}`
  const subject = `Site audit finished — ${input.domain} (ADA ${fmtScore(input.adaScore)} · ${seoPart})`
  const greeting = input.requestedBy ? `Hi ${input.requestedBy},` : 'Hi,'
  const seoLine = input.seoUnavailable
    ? 'SEO analysis unavailable for this run.'
    : `SEO score: ${fmtScore(input.seoScore)}`
  const lines = [
    greeting,
    ``,
    `Your ${input.scanType} site audit for ${input.domain} has finished.`,
    ``,
    `ADA score: ${fmtScore(input.adaScore)}`,
    seoLine,
    `Duration: ${fmtDuration(input.durationMs)}`,
    ``,
    `View the results: ${input.resultsUrl}`,
  ]
  const text = lines.join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111;">
    <p>${esc(greeting)}</p>
    <p>Your ${esc(input.scanType)} site audit for <strong>${esc(input.domain)}</strong> has finished.</p>
    <ul>
      <li>ADA score: ${fmtScore(input.adaScore)}</li>
      <li>${esc(seoLine)}</li>
      <li>Duration: ${esc(fmtDuration(input.durationMs))}</li>
    </ul>
    <p><a href="${esc(input.resultsUrl)}">View the results</a></p>
  </div>`
  return { subject, html, text }
}

export interface FailedInput {
  domain: string
  requestedBy: string | null
  error: string
  resultsUrl: string
}

export function buildFailedEmail(input: FailedInput): EmailContent {
  const subject = `Site audit FAILED — ${input.domain}`
  const lines = [
    `A site audit failed.`,
    ``,
    `Domain: ${input.domain}`,
    `Requested by: ${input.requestedBy ?? 'unknown'}`,
    `Error: ${input.error}`,
    ``,
    `Audit: ${input.resultsUrl}`,
  ]
  const text = lines.join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111;">
    <p>A site audit failed.</p>
    <ul>
      <li>Domain: <strong>${esc(input.domain)}</strong></li>
      <li>Requested by: ${esc(input.requestedBy ?? 'unknown')}</li>
      <li>Error: ${esc(input.error)}</li>
    </ul>
    <p><a href="${esc(input.resultsUrl)}">Open the audit</a></p>
  </div>`
  return { subject, html, text }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/notify/content.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/notify/config.ts lib/notify/content.ts lib/notify/content.test.ts
git commit -m "feat(notify): D7 config env reads + pure email content builders"
```

---

## Task 3: Mailgun transport (injectable deps)

**Files:**
- Create: `lib/notify/transport.ts`, `lib/notify/transport.test.ts`

**Interfaces:**
- Consumes: `mailgunConfig`, `notifyFrom`, `notifyReplyTo` from `./config`; `EmailContent` from `./content`.
- Produces:
  - `interface NotifyDeps { fetch: typeof fetch; now: () => number }`
  - `realNotifyDeps: NotifyDeps`
  - `interface SendArgs { to: string; content: EmailContent }`
  - `sendEmail(args: SendArgs, deps?: NotifyDeps): Promise<void>` — POSTs to Mailgun; throws on non-2xx or disabled config. Never logs the API key.

- [ ] **Step 1: Write the failing test** at `lib/notify/transport.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendEmail } from './transport'

const content = { subject: 'S', html: '<p>h</p>', text: 't' }

describe('sendEmail', () => {
  const OLD = process.env
  beforeEach(() => { process.env = { ...OLD, MAILGUN_API_KEY: 'key-abc', MAILGUN_DOMAIN: 'mg.example.com' } })
  afterEach(() => { process.env = OLD })

  it('POSTs form-encoded to the Mailgun messages endpoint with Basic auth', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"<1@mg>"}', { status: 200 }))
    await sendEmail({ to: 'r@example.com', content }, { fetch: fetchMock as unknown as typeof fetch, now: () => 0 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://api.mailgun.net/v3/mg.example.com/messages')
    expect((init as RequestInit).method).toBe('POST')
    const auth = (init as RequestInit).headers as Record<string, string>
    expect(auth.Authorization).toBe(`Basic ${Buffer.from('api:key-abc').toString('base64')}`)
    const body = (init as RequestInit).body as URLSearchParams
    expect(body.get('to')).toBe('r@example.com')
    expect(body.get('subject')).toBe('S')
  })

  it('throws on non-2xx and the error message never contains the API key', async () => {
    const fetchMock = vi.fn(async () => new Response('Forbidden: bad key key-abc', { status: 401 }))
    await expect(
      sendEmail({ to: 'r@example.com', content }, { fetch: fetchMock as unknown as typeof fetch, now: () => 0 }),
    ).rejects.toThrow()
    try {
      await sendEmail({ to: 'r@example.com', content }, { fetch: fetchMock as unknown as typeof fetch, now: () => 0 })
    } catch (e) {
      expect((e as Error).message).not.toContain('key-abc')
    }
  })

  it('throws when Mailgun config is absent (dark)', async () => {
    process.env = { ...OLD }
    delete process.env.MAILGUN_API_KEY
    const fetchMock = vi.fn()
    await expect(
      sendEmail({ to: 'r@example.com', content }, { fetch: fetchMock as unknown as typeof fetch, now: () => 0 }),
    ).rejects.toThrow(/not configured/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/notify/transport.test.ts`
Expected: FAIL — `Cannot find module './transport'`.

- [ ] **Step 3: Implement `lib/notify/transport.ts`**

```ts
// lib/notify/transport.ts
// Mailgun Messages API over plain fetch — no SDK, no SMTP. Injectable deps so
// all callers/tests run mocked. NEVER logs MAILGUN_API_KEY; error bodies are
// truncated before being surfaced.

import { mailgunConfig, notifyFrom, notifyReplyTo, notifyRequestTimeoutMs } from './config'
import type { EmailContent } from './content'

export interface NotifyDeps {
  fetch: typeof fetch
  now: () => number
}

export const realNotifyDeps: NotifyDeps = {
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
}

export interface SendArgs {
  to: string
  content: EmailContent
}

export async function sendEmail(args: SendArgs, deps: NotifyDeps = realNotifyDeps): Promise<void> {
  const cfg = mailgunConfig()
  if (!cfg) throw new Error('notify transport not configured (Mailgun env unset)')

  const body = new URLSearchParams()
  body.set('from', notifyFrom())
  body.set('h:Reply-To', notifyReplyTo())
  body.set('to', args.to)
  body.set('subject', args.content.subject)
  body.set('text', args.content.text)
  body.set('html', args.content.html)

  const res = await deps.fetch(`${cfg.baseUrl}/v3/${cfg.domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${cfg.apiKey}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(notifyRequestTimeoutMs()),
  })

  if (res.status < 200 || res.status >= 300) {
    let snippet = ''
    try { snippet = (await res.text()).slice(0, 200) } catch { /* ignore */ }
    // Redact the key defensively in case Mailgun echoes it.
    if (cfg.apiKey) snippet = snippet.split(cfg.apiKey).join('<redacted>')
    throw new Error(`Mailgun send failed: ${res.status} ${snippet}`)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/notify/transport.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/notify/transport.ts lib/notify/transport.test.ts
git commit -m "feat(notify): D7 Mailgun HTTP transport (injectable, key-safe logging)"
```

---

## Task 4: Durable notify-email job handler

**Files:**
- Create: `lib/jobs/handlers/notify-email.ts`, `lib/jobs/handlers/notify-email.test.ts`
- Modify: `lib/jobs/handlers/register.ts`

**Interfaces:**
- Consumes: `sendEmail`, `NotifyDeps`, `realNotifyDeps` (`@/lib/notify/transport`); `buildCompleteEmail`, `buildFailedEmail` (`@/lib/notify/content`); `isNotifyEnabled`, `notifyAdminEmail` (`@/lib/notify/config`); `registerJobHandler` (`../registry`); `enqueueJob` (`../queue`).
- Produces:
  - `NOTIFY_EMAIL_JOB_TYPE = 'notify-email'`
  - `interface NotifyEmailJob { siteAuditId: string; kind: 'complete' | 'failed' }`
  - `runNotifyEmailJob(payload: unknown, deps?: NotifyDeps): Promise<void>`
  - `enqueueNotifyEmail(siteAuditId: string, kind: 'complete' | 'failed'): Promise<unknown>` — fire-and-forget style (no `site-audit:<id>` group key).
  - `registerNotifyEmailHandler(): void`

**Handler behavior (Codex fixes #1, #4, #8):**
- Resolve `resultsUrl` from `NEXT_PUBLIC_APP_URL` (never request origin): `${base}/ada-audit/site/${id}`.
- No-op (return, do NOT throw) when: `!isNotifyEnabled()`; row deleted; `notifyEmail` null (complete) / no admin recipient (failed); the relevant sent-marker already non-null.
- Order: read row → send → stamp marker conditionally.
- `groupKey` is NOT `site-audit:<id>` (would be cancelled by `failSiteAudit`'s `cancelJobsByGroup`). Use no group key.

- [ ] **Step 1: Write the failing test** at `lib/jobs/handlers/notify-email.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { runNotifyEmailJob } from './notify-email'

const deps = { fetch: vi.fn(), now: () => 0 }
// vi.mock is hoisted above imports — the spy must be created with vi.hoisted so
// the factory can reference it safely (Codex plan-fix #1).
const { sendSpy } = vi.hoisted(() => ({ sendSpy: vi.fn(async () => {}) }))
vi.mock('@/lib/notify/transport', async (orig) => {
  const mod = await orig<typeof import('@/lib/notify/transport')>()
  return { ...mod, sendEmail: (...a: unknown[]) => sendSpy(...a) }
})

async function mkAudit(data: Record<string, unknown>): Promise<string> {
  const a = await prisma.siteAudit.create({
    data: { domain: 'notify-test.example', status: 'complete', wcagLevel: 'wcag21aa', ...data },
  })
  return a.id
}

describe('runNotifyEmailJob', () => {
  const OLD = process.env
  beforeEach(() => { sendSpy.mockClear(); process.env = { ...OLD, MAILGUN_API_KEY: 'k', MAILGUN_DOMAIN: 'mg.x', NEXT_PUBLIC_APP_URL: 'https://app.example' } })
  afterEach(async () => { process.env = OLD; await prisma.siteAudit.deleteMany({ where: { domain: 'notify-test.example' } }) })

  it('sends the complete email and stamps notifyCompleteSentAt', async () => {
    const id = await mkAudit({ notifyEmail: 'r@example.com' })
    await runNotifyEmailJob({ siteAuditId: id, kind: 'complete' }, deps)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const row = await prisma.siteAudit.findUnique({ where: { id } })
    expect(row?.notifyCompleteSentAt).not.toBeNull()
  })

  it('no-ops when notifyEmail is null (complete)', async () => {
    const id = await mkAudit({ notifyEmail: null })
    await runNotifyEmailJob({ siteAuditId: id, kind: 'complete' }, deps)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('no-ops when the sent-marker is already set (recovery replay)', async () => {
    const id = await mkAudit({ notifyEmail: 'r@example.com', notifyCompleteSentAt: new Date() })
    await runNotifyEmailJob({ siteAuditId: id, kind: 'complete' }, deps)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('no-ops when the audit row was deleted', async () => {
    await runNotifyEmailJob({ siteAuditId: 'does-not-exist', kind: 'complete' }, deps)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('no-ops (dark) when Mailgun env is unset', async () => {
    const id = await mkAudit({ notifyEmail: 'r@example.com' })
    delete process.env.MAILGUN_API_KEY
    await runNotifyEmailJob({ siteAuditId: id, kind: 'complete' }, deps)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('failed kind routes to the admin address and stamps notifyFailedSentAt', async () => {
    process.env.NOTIFY_ADMIN_EMAIL = 'admin@example.com'
    const id = await mkAudit({ notifyEmail: 'r@example.com', status: 'error', error: 'boom' })
    await runNotifyEmailJob({ siteAuditId: id, kind: 'failed' }, deps)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const arg = sendSpy.mock.calls[0][0] as { to: string }
    expect(arg.to).toBe('admin@example.com')
    const row = await prisma.siteAudit.findUnique({ where: { id } })
    expect(row?.notifyFailedSentAt).not.toBeNull()
  })

  it('no-ops the failed kind when notifyFailedSentAt is already set (recovery replay)', async () => {
    const id = await mkAudit({ notifyEmail: 'r@example.com', status: 'error', error: 'boom', notifyFailedSentAt: new Date() })
    await runNotifyEmailJob({ siteAuditId: id, kind: 'failed' }, deps)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('re-sends after a send failure (marker not stamped)', async () => {
    const id = await mkAudit({ notifyEmail: 'r@example.com' })
    sendSpy.mockRejectedValueOnce(new Error('transient'))
    await expect(runNotifyEmailJob({ siteAuditId: id, kind: 'complete' }, deps)).rejects.toThrow()
    let row = await prisma.siteAudit.findUnique({ where: { id } })
    expect(row?.notifyCompleteSentAt).toBeNull()
    await runNotifyEmailJob({ siteAuditId: id, kind: 'complete' }, deps)
    expect(sendSpy).toHaveBeenCalledTimes(2)
    row = await prisma.siteAudit.findUnique({ where: { id } })
    expect(row?.notifyCompleteSentAt).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/notify-email.test.ts`
Expected: FAIL — `Cannot find module './notify-email'`.

- [ ] **Step 3: Implement `lib/jobs/handlers/notify-email.ts`**

```ts
// lib/jobs/handlers/notify-email.ts
//
// D7 durable scan-completion notifier. Recipient + content resolved at send
// time from the SiteAudit row. Idempotency guard = durable sent-markers
// (dedupKey is active-window only). NO site-audit:<id> group key — failSiteAudit
// cancels that group. Concurrency 1, 3 attempts + backoff.
//
// No-op (return, never throw) when: feature dark; row deleted; no recipient;
// sent-marker already set. A send failure THROWS -> one retry; the marker is
// only stamped AFTER a successful send (at-least-once, narrow dup window).

import { prisma } from '@/lib/db'
import { isNotifyEnabled, notifyAdminEmail } from '@/lib/notify/config'
import { buildCompleteEmail, buildFailedEmail } from '@/lib/notify/content'
import { sendEmail, realNotifyDeps, type NotifyDeps } from '@/lib/notify/transport'
import { registerJobHandler } from '../registry'
import { enqueueJob } from '../queue'

export const NOTIFY_EMAIL_JOB_TYPE = 'notify-email'

export interface NotifyEmailJob {
  siteAuditId: string
  kind: 'complete' | 'failed'
}

function assertPayload(payload: unknown): NotifyEmailJob {
  const p = payload as Partial<NotifyEmailJob> | null
  if (!p || typeof p.siteAuditId !== 'string' || (p.kind !== 'complete' && p.kind !== 'failed')) {
    throw new Error('Invalid notify-email job payload')
  }
  return p as NotifyEmailJob
}

// Returns null when NEXT_PUBLIC_APP_URL is unset — the handler then no-ops
// rather than emailing a relative, un-clickable link (Codex plan-fix #7).
function resultsUrl(id: string): string | null {
  const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
  if (!base) return null
  return `${base}/ada-audit/site/${id}`
}

export async function runNotifyEmailJob(payload: unknown, deps: NotifyDeps = realNotifyDeps): Promise<void> {
  const { siteAuditId, kind } = assertPayload(payload)
  if (!isNotifyEnabled()) return // dark — clean no-op, no retry burn

  const audit = await prisma.siteAudit.findUnique({
    where: { id: siteAuditId },
    select: {
      id: true, domain: true, status: true, error: true, requestedBy: true, notifyEmail: true,
      seoOnly: true, seoIntent: true, notifyCompleteSentAt: true, notifyFailedSentAt: true,
      startedAt: true, completedAt: true,
      crawlRuns: { select: { tool: true, source: true, score: true } },
    },
  })
  if (!audit) return // deleted -> no-op
  if (!audit.notifyEmail) return // opt-in never set -> silent
  const url = resultsUrl(audit.id)
  if (!url) return // NEXT_PUBLIC_APP_URL unset -> no relative-link email (Codex #7)

  if (kind === 'complete') {
    if (audit.notifyCompleteSentAt) return // already sent
    const adaScore = audit.crawlRuns.find((r) => r.tool === 'ada-audit')?.score ?? null
    // Live SEO score: the seo-parser live-scan run (precise identity — Codex #4).
    const seoRun = audit.crawlRuns.find((r) => r.tool === 'seo-parser' && r.source === 'live-scan')
    const liveScore = seoRun?.score ?? null
    const durationMs = audit.startedAt && audit.completedAt
      ? audit.completedAt.getTime() - audit.startedAt.getTime() : null
    const scanType = audit.seoOnly ? 'SEO' : audit.seoIntent ? 'ADA + SEO' : 'ADA'
    const content = buildCompleteEmail({
      domain: audit.domain, scanType, requestedBy: audit.requestedBy,
      adaScore: audit.seoOnly ? null : adaScore, seoScore: liveScore, durationMs,
      resultsUrl: url, seoUnavailable: !seoRun,
    })
    await sendEmail({ to: audit.notifyEmail, content }, deps)
    await prisma.siteAudit.updateMany({
      where: { id: audit.id, notifyCompleteSentAt: null },
      data: { notifyCompleteSentAt: new Date() },
    })
    return
  }

  // failed
  if (audit.notifyFailedSentAt) return // already sent
  const admin = notifyAdminEmail()
  if (!admin) return
  const content = buildFailedEmail({
    domain: audit.domain, requestedBy: audit.requestedBy,
    error: audit.error ?? 'Unknown error', resultsUrl: url,
  })
  await sendEmail({ to: admin, content }, deps)
  await prisma.siteAudit.updateMany({
    where: { id: audit.id, notifyFailedSentAt: null },
    data: { notifyFailedSentAt: new Date() },
  })
}

export function enqueueNotifyEmail(siteAuditId: string, kind: 'complete' | 'failed'): Promise<unknown> {
  return enqueueJob({
    type: NOTIFY_EMAIL_JOB_TYPE,
    payload: { siteAuditId, kind },
    dedupKey: `${NOTIFY_EMAIL_JOB_TYPE}:${siteAuditId}:${kind}`,
    // NO groupKey: must not be site-audit:<id> (failSiteAudit cancels that group).
  }).catch((err) => {
    console.error('[notify-email] enqueue failed for', siteAuditId, kind, ':', (err as Error).message)
  })
}

export function registerNotifyEmailHandler(): void {
  registerJobHandler({
    type: NOTIFY_EMAIL_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 3,
    backoffBaseMs: 30_000,
    timeoutMs: 30_000,
    handler: (payload) => runNotifyEmailJob(payload),
  })
}
```

- [ ] **Step 4: Register the handler** in `lib/jobs/handlers/register.ts`:

```ts
import { registerNotifyEmailHandler } from './notify-email'
// ... inside registerBuiltInJobHandlers():
  registerNotifyEmailHandler()
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/notify-email.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/jobs/handlers/notify-email.ts lib/jobs/handlers/notify-email.test.ts lib/jobs/handlers/register.ts
git commit -m "feat(notify): D7 durable notify-email job (marker idempotency, no-op cases)"
```

---

## Task 5: Server-side recipient stamping (API + queue path)

**Files:**
- Modify: `lib/ada-audit/queue-request.ts`, `lib/ada-audit/queue-manager.ts`, `app/api/site-audit/route.ts`
- Modify (test): `app/api/site-audit/route.test.ts`

**Interfaces:**
- `QueueRequestInput` gains `notifyEmail?: string | null`.
- `EnqueueAuditOptions` gains `notifyEmail?: string | null`.
- `SiteAudit.create` writes `notifyEmail: notifyEmail ?? null`.
- Route: `const session = await getAuthSession(request.cookies.get(AUTH_COOKIE_NAME)?.value)`; `notifyEmail = raw.notify === true && session?.email ? session.email : null`.

- [ ] **Step 1: Write the failing test** — add to `app/api/site-audit/route.test.ts` (follow the file's existing DB-backed pattern; craft a valid signed auth cookie via `createAuthCookieValue`):

```ts
import { createAuthCookieValue, AUTH_COOKIE_NAME } from '@/lib/auth'
// ... within the POST describe block:

it('stamps notifyEmail from the verified session when notify:true', async () => {
  const cookie = await createAuthCookieValue({ sub: 'google:1', email: 'op@enrollmentresources.com', hd: 'enrollmentresources.com', name: 'Op' })
  const req = new NextRequest('http://localhost/api/site-audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `${AUTH_COOKIE_NAME}=${cookie}` },
    body: JSON.stringify({ domain: 'notify-stamp.example', notify: true, email: 'attacker@evil.com' }),
  })
  const res = await POST(req)
  expect(res.status).toBe(202)
  const { id } = await res.json()
  const row = await prisma.siteAudit.findUnique({ where: { id } })
  expect(row?.notifyEmail).toBe('op@enrollmentresources.com') // session wins; client email ignored
})

it('leaves notifyEmail null when notify is absent', async () => {
  const cookie = await createAuthCookieValue({ sub: 'google:1', email: 'op@enrollmentresources.com', hd: 'enrollmentresources.com', name: 'Op' })
  const req = new NextRequest('http://localhost/api/site-audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `${AUTH_COOKIE_NAME}=${cookie}` },
    body: JSON.stringify({ domain: 'notify-none.example' }),
  })
  const res = await POST(req)
  const { id } = await res.json()
  const row = await prisma.siteAudit.findUnique({ where: { id } })
  expect(row?.notifyEmail).toBeNull()
})

it('leaves notifyEmail null when notify:true but there is no session email', async () => {
  const req = new NextRequest('http://localhost/api/site-audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }, // no auth cookie
    body: JSON.stringify({ domain: 'notify-nosession.example', notify: true }),
  })
  const res = await POST(req)
  const { id } = await res.json()
  const row = await prisma.siteAudit.findUnique({ where: { id } })
  expect(row?.notifyEmail).toBeNull()
})
```

Also add a silence test near the scheduled/bulk coverage (or in `lib/ada-audit/queue-request` tests if that's where scheduled paths are exercised): assert an audit created via `queueSiteAuditRequest({...})` without `notifyEmail` has `notifyEmail === null`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/site-audit/route.test.ts`
Expected: FAIL — `notifyEmail` is `undefined`/`null` where the first test expects the session email (column not stamped yet).

- [ ] **Step 3a: Thread `notifyEmail` through `EnqueueAuditOptions`** (`lib/ada-audit/queue-manager.ts`):

```ts
export interface EnqueueAuditOptions {
  preDiscoveredUrls?: string[]
  requestedBy?: string | null
  scheduleId?: string | null
  seoIntent?: boolean
  seoOnly?: boolean
  notifyEmail?: string | null // D7: verified session email; null = silent
}
// in enqueueAudit destructure:
const { requestedBy, scheduleId, seoIntent, seoOnly, notifyEmail } = opts
// in prisma.siteAudit.create data:
      seoOnly: seoOnly ?? false,
      notifyEmail: notifyEmail ?? null,
```

- [ ] **Step 3b: Thread through `queueSiteAuditRequest`** (`lib/ada-audit/queue-request.ts`):

```ts
export interface QueueRequestInput {
  // ...existing...
  seoOnly?: boolean
  /** D7: verified session email to notify on completion. null/absent = silent. */
  notifyEmail?: string | null
}
// in the enqueueAudit(...) call opts:
    seoIntent: (input.seoIntent ?? false) || seoOnly,
    seoOnly,
    notifyEmail: input.notifyEmail ?? null,
```

- [ ] **Step 3c: Stamp in the route** (`app/api/site-audit/route.ts`):

```ts
import { OPERATOR_NAME_COOKIE_NAME, sanitizeOperatorName, AUTH_COOKIE_NAME, getAuthSession } from '@/lib/auth'
// ... after requestedBy:
  const session = await getAuthSession(request.cookies.get(AUTH_COOKIE_NAME)?.value)
  const notifyEmail = raw?.notify === true && session?.email ? session.email : null
// ... add to the queueSiteAuditRequest({...}) call:
    seoIntent,
    seoOnly,
    notifyEmail,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/site-audit/route.test.ts`
Expected: PASS. Confirm no `notifyEmail` was added to the scheduled/bulk callers (they never pass it → default null).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/queue-request.ts lib/ada-audit/queue-manager.ts app/api/site-audit/route.ts app/api/site-audit/route.test.ts
git commit -m "feat(notify): D7 stamp notifyEmail server-side from verified session"
```

---

## Task 6: Send seams (complete + failed)

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts` (complete seam + onExhausted)
- Modify: `lib/ada-audit/queue-manager.ts` (`failSiteAudit` failed seam)
- Modify (test): `lib/jobs/handlers/broken-link-verify.test.ts`, `lib/ada-audit/queue-manager.test.ts` (or the nearest existing failSiteAudit test file)

**Interfaces:**
- Consumes: `enqueueNotifyEmail` from `./notify-email`.

- [ ] **Step 1: Write the failing test** — in `lib/jobs/handlers/broken-link-verify.test.ts`, add a spy on `enqueueNotifyEmail` and assert it is called once with `(id, 'complete')` after a successful `runBrokenLinkVerify` on an audit whose `notifyEmail` is set, and NOT called when `notifyEmail` is null:

```ts
import * as notify from './notify-email'
// ...
it('enqueues a complete notification when the audit opted in', async () => {
  const spy = vi.spyOn(notify, 'enqueueNotifyEmail').mockResolvedValue(undefined)
  // create a complete SiteAudit with notifyEmail set + minimal harvest rows (reuse the file's existing setup helper)
  // ... run runBrokenLinkVerify({ siteAuditId, domain }, mockDeps)
  expect(spy).toHaveBeenCalledWith(siteAuditId, 'complete')
})
it('does not enqueue when notifyEmail is null', async () => {
  const spy = vi.spyOn(notify, 'enqueueNotifyEmail').mockResolvedValue(undefined)
  // ... audit with notifyEmail: null
  expect(spy).not.toHaveBeenCalled()
})
```

For `failSiteAudit`, add a test: a non-terminal audit with `notifyEmail` set, when failed, enqueues `(id, 'failed')`; with `notifyEmail` null it does not.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: FAIL — `enqueueNotifyEmail` never called.

- [ ] **Step 3a: Add `notifyEmail` + `notifyCompleteSentAt` to the `site` select** in `runBrokenLinkVerify` (`lib/jobs/handlers/broken-link-verify.ts`, the `prisma.siteAudit.findUnique` near line 131):

```ts
    select: {
      id: true, domain: true, clientId: true, pagesTotal: true, pagesError: true, seoIntent: true,
      discoveredUrls: true, discoveryMode: true, discoveryCapped: true, discoverySourcesJson: true,
      notifyEmail: true, notifyCompleteSentAt: true,
    },
```

- [ ] **Step 3b: At the END of `runBrokenLinkVerify`** (after the two `deleteMany` + the final `console.log`), enqueue the complete notification — awaited inside try/catch (Codex fix #2), gated on opt-in:

```ts
  // D7: notify the requester that the scan (incl. this SEO pass) finished.
  // Awaited-in-try/catch, not bare fire-and-forget: don't let the verify job
  // settle before the notify insert is attempted; the catch guarantees a notify
  // failure never fails the builder (findings-hook rule).
  // Gate on the marker too (Codex plan-fix #5): a retry after a successful
  // send should not re-enqueue a redundant notify job.
  if (site.notifyEmail && !site.notifyCompleteSentAt) {
    try { await enqueueNotifyEmail(site.id, 'complete') }
    catch (e) { console.error('[notify-email] complete enqueue failed', site.id, e) }
  }
```

Add the import at the top: `import { enqueueNotifyEmail } from './notify-email'`.

- [ ] **Step 3c: In `onBrokenLinkVerifyExhausted`** — the parent is already terminal `complete`, so still send the completion email (the content builder tolerates a missing SEO run):

```ts
export async function onBrokenLinkVerifyExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  console.warn(`[broken-link-verify] exhausted after ${ctx.attempts} attempts: ${ctx.lastError}`)
  const p = payload as { siteAuditId?: string } | null
  if (!p?.siteAuditId) return
  const row = await prisma.siteAudit.findUnique({ where: { id: p.siteAuditId }, select: { notifyEmail: true } }).catch(() => null)
  if (row?.notifyEmail) { try { await enqueueNotifyEmail(p.siteAuditId, 'complete') } catch { /* never throw from onExhausted */ } }
}
```

- [ ] **Step 3d: In `failSiteAudit`** (`lib/ada-audit/queue-manager.ts`) — after `cancelJobsByGroup`, enqueue the failed notification only when the parent actually flipped (`flipped > 0`, already guaranteed at this point) and `notifyEmail` is set. Reuse the existing `findUnique` (extend its select):

```ts
  await cancelJobsByGroup(`site-audit:${id}`).catch(() => {})
  const row = await prisma.siteAudit.findUnique({
    where: { id },
    select: { batchId: true, notifyEmail: true },
  }).catch(() => null)
  if (row?.notifyEmail) {
    const { enqueueNotifyEmail } = await import('@/lib/jobs/handlers/notify-email') // await import: avoid a jobs<->queue-manager import cycle
    await enqueueNotifyEmail(id, 'failed').catch(() => {})
  }
  if (row?.batchId) {
    await closeBatchIfDrained(row.batchId).catch(() => {})
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts lib/ada-audit/queue-manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/ada-audit/queue-manager.ts lib/jobs/handlers/broken-link-verify.test.ts lib/ada-audit/queue-manager.test.ts
git commit -m "feat(notify): D7 send seams — complete (verify end + onExhausted) + failed"
```

---

## Task 7: UI checkbox on both forms

**Files:**
- Modify: `app/(app)/ada-audit/page.tsx`, `components/ada-audit/AuditIndexTabs.tsx`, `components/ada-audit/SiteAuditForm.tsx` + `.test.tsx`
- Modify: `app/(app)/seo-audits/page.tsx`, `components/seo-parser/SeoAuditTabs.tsx`, `components/seo-parser/SeoScanForm.tsx` + `.test.tsx`

**Interfaces:**
- Server pages derive `notifyAvailable = Boolean((await getAuthSession(cookie))?.email)` and pass it through the tab component to the form.
- Both forms accept `notifyAvailable?: boolean` (default false → checkbox hidden), render an ALWAYS-unchecked-on-load checkbox "Email me when this finishes", and include `notify: <checked>` in the POST body.

**Dark-mode note (UI change class):** the checkbox label uses existing form text classes; a plain `<input type="checkbox">` + `<label>` needs `text-navy dark:text-white/70` on the label and no new color surfaces. No hydration-sensitive rendering (the checkbox default is a constant `false`, not theme/localStorage-derived).

- [ ] **Step 1: Write the failing component test** — `components/ada-audit/SiteAuditForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import SiteAuditForm from './SiteAuditForm'

// Reuse the file's existing fetch/clients mocks; add:
describe('D7 notify checkbox', () => {
  beforeEach(() => { cleanup() })

  it('is hidden when notifyAvailable is false', () => {
    render(<SiteAuditForm queueStatus={null} notifyAvailable={false} />)
    expect(screen.queryByText(/email me when this finishes/i)).toBeNull()
  })

  it('is shown and unchecked on load when notifyAvailable is true', () => {
    render(<SiteAuditForm queueStatus={null} notifyAvailable={true} />)
    const cb = screen.getByLabelText(/email me when this finishes/i) as HTMLInputElement
    expect(cb.checked).toBe(false)
  })

  it('stays unchecked after unmount/remount (never sticky)', () => {
    const { unmount } = render(<SiteAuditForm queueStatus={null} notifyAvailable={true} />)
    fireEvent.click(screen.getByLabelText(/email me when this finishes/i))
    unmount()
    render(<SiteAuditForm queueStatus={null} notifyAvailable={true} />)
    const cb = screen.getByLabelText(/email me when this finishes/i) as HTMLInputElement
    expect(cb.checked).toBe(false)
  })

  // Codex plan-fix #6 — the actual contract: a ticked box must POST notify:true.
  // Reuse the file's existing submit-flow setup (client-list mock, domain fill,
  // discover mock). Capture the /api/site-audit POST and assert the parsed body.
  it('posts notify:true on the discover→run path when the box is ticked', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/site-audit') && !url.includes('discover') && init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)))
        return new Response(JSON.stringify({ id: 'x', status: 'queued' }), { status: 202 })
      }
      if (typeof url === 'string' && url.includes('/discover')) return new Response(JSON.stringify({ urls: ['https://d.example/'], domain: 'd.example' }), { status: 200 })
      return new Response(JSON.stringify([]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SiteAuditForm queueStatus={null} notifyAvailable={true} />)
    // ... drive the existing submit flow: fill domain 'd.example', discover, then submit.
    fireEvent.click(screen.getByLabelText(/email me when this finishes/i))
    // ... trigger the run submit (reuse the file's existing button query).
    expect(bodies.some((b) => b.notify === true)).toBe(true)
  })

  it('posts notify:false when the box is left unticked', async () => {
    // Same setup, WITHOUT clicking the checkbox → expect every captured body b.notify === false.
  })
})
```

Add matching tests in `components/seo-parser/SeoScanForm.test.tsx`: hidden-when-false / unchecked-on-load (as above), AND ticking the box makes the `/api/site-audit` POST body carry `notify: true` (capture the fetch body the same way).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/SiteAuditForm.test.tsx components/seo-parser/SeoScanForm.test.tsx`
Expected: FAIL — checkbox not found / prop unknown.

- [ ] **Step 3a: `SiteAuditForm.tsx`** — add prop + state + checkbox + POST field:

```tsx
interface Props {
  queueStatus: QueueStatusWithBatch | null
  notifyAvailable?: boolean
}
export default function SiteAuditForm({ queueStatus, notifyAvailable = false }: Props) {
  // ...existing state...
  const [notify, setNotify] = useState(false) // ALWAYS false on mount — never persisted
```

In BOTH `/api/site-audit` POST bodies (the discover-then-run path ~line 185 and the manual path ~line 247), add `notify,` to the `JSON.stringify({...})`.

Render the checkbox near the submit button (only when `notifyAvailable`):

```tsx
{notifyAvailable && (
  <label className="flex items-center gap-2 text-[13px] text-navy dark:text-white/70">
    <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
    Email me when this finishes
  </label>
)}
```

- [ ] **Step 3b: `AuditIndexTabs.tsx`** — thread the prop:

```tsx
interface Props {
  recentItems: /* existing */ unknown
  operator: string | null
  initialScope: 'mine' | 'all'
  notifyAvailable?: boolean
}
export default function AuditIndexTabs({ recentItems, operator, initialScope, notifyAvailable = false }: Props) {
  // ...
  // render: <SiteAuditForm queueStatus={queueStatus} notifyAvailable={notifyAvailable} />
```

- [ ] **Step 3c: `app/(app)/ada-audit/page.tsx`** — derive server-side:

```tsx
import { AUTH_COOKIE_NAME, OPERATOR_NAME_COOKIE_NAME, getAuthSession, getOperatorLabel } from '@/lib/auth'
// ...
  const authCookie = c.get(AUTH_COOKIE_NAME)?.value
  const operator = await getOperatorLabel(authCookie, c.get(OPERATOR_NAME_COOKIE_NAME)?.value)
  const notifyAvailable = Boolean((await getAuthSession(authCookie))?.email)
  // ...
  <AuditIndexTabs recentItems={recentItems} operator={operator} initialScope={initialScope} notifyAvailable={notifyAvailable} />
```

- [ ] **Step 3d: `SeoScanForm.tsx`** — add prop + state + checkbox + POST field:

```tsx
export function SeoScanForm({ notifyAvailable = false }: { notifyAvailable?: boolean }) {
  // ...
  const [notify, setNotify] = useState(false)
  // in the POST body (~line 151): body: JSON.stringify({ domain: value, seoOnly: true, notify }),
  // render the same checkbox block, gated on notifyAvailable, near the scan button.
```

- [ ] **Step 3e: `SeoAuditTabs.tsx`** — accept + pass the prop:

```tsx
export function SeoAuditTabs({ notifyAvailable = false }: { notifyAvailable?: boolean }) {
  // ...
  {tab === 'scan' ? <SeoScanForm notifyAvailable={notifyAvailable} /> : <SeoUploadCard />}
```

- [ ] **Step 3f: `app/(app)/seo-audits/page.tsx`** — derive server-side and pass to `SeoAuditTabs` (add `import { cookies } from 'next/headers'` + `getAuthSession`/`AUTH_COOKIE_NAME` if not present; make the component `async` if it isn't). Mirror the ada-audit page derivation:

```tsx
  const c = await cookies()
  const notifyAvailable = Boolean((await getAuthSession(c.get(AUTH_COOKIE_NAME)?.value))?.email)
  // render: <SeoAuditTabs notifyAvailable={notifyAvailable} />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/SiteAuditForm.test.tsx components/seo-parser/SeoScanForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/ada-audit/page.tsx" components/ada-audit/AuditIndexTabs.tsx components/ada-audit/SiteAuditForm.tsx components/ada-audit/SiteAuditForm.test.tsx "app/(app)/seo-audits/page.tsx" components/seo-parser/SeoAuditTabs.tsx components/seo-parser/SeoScanForm.tsx components/seo-parser/SeoScanForm.test.tsx
git commit -m "feat(notify): D7 opt-in checkbox on SiteAuditForm + SeoScanForm (unchecked, session-gated)"
```

---

## Task 8: Docs — CLAUDE.md + gates

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `CLAUDE.md`** — add a Key files bullet for `lib/notify/`, an Architecture pattern paragraph for D7 (send seams, dark-by-default, marker idempotency, `NOTIFY_FROM`/`NOTIFY_REPLY_TO` alignment note), and the new env vars. Do NOT add Mailgun envs to any fail-fast list.

- [ ] **Step 2: Run the full gate**

```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: D7 scan-email notifications — CLAUDE.md key files + pattern + env"
```

---

## Self-review checklist (run before PR)

- **Spec coverage:** decisions 1–7 all map to a task (D1 scope → Task 6 seam gating; D2 recipient → Task 5; D3 admin → Task 4/6; D4 timing → Task 6; D5 checkbox → Task 7; D6 silence → Task 5 default-null + tests; D7 sender → Task 2/3 config). Codex fixes 1–10 all landed (markers T1/T4; awaited enqueue T6; onExhausted content T2/T4; failSiteAudit flip+group T6; stamping T5; UI gating T7; schedules/bulk silent T5; handler no-ops T4; transport timeout+sanitized T3; NOTIFY_REPLY_TO T2/T3).
- **Placeholder scan:** none — every code step shows code.
- **Codex plan review (2026-07-08, accept-with-fixes):** all 9 named fixes applied in place — vi.hoisted mock (#1), `notifyRequestTimeoutMs()` in config (#2), illustrative import removed (#3), `tool==='seo-parser' && source==='live-scan'` score predicate (#4), Task 6 select+gate on `notifyCompleteSentAt` (#5), POST-body notify:true tests (#6), `resultsUrl` null-when-base-unset no-op (#7), `AUTH_COOKIE_NAME` in route tests (#8), failed-marker no-double test (#9).
- **Type consistency:** `notifyEmail` / `notifyCompleteSentAt` / `notifyFailedSentAt` spelled identically across schema, queue path, handler, seams; `NotifyEmailJob.kind` union `'complete' | 'failed'` consistent; `enqueueNotifyEmail(id, kind)` signature consistent at all call sites.

## Prod verification (post-deploy, Task in the deploy phase not this plan)

Dark-by-default means a clean deploy is safe even if the domain never verifies. Real-send smoke: run a site audit on a client domain or `*.erstaging.site` with the checkbox ticked (logged in as `kevin@enrollmentresources.com`) → confirm an email arrives at Kevin's inbox. If Gmail spam-folders or flags the cross-domain From, flip `NOTIFY_FROM` to an `@enrollment.email` sender (Kevin, env only) — see spec §Transport. If the Mailgun domain is unverified, flag the smoke as BLOCKED for Kevin rather than faking it.
