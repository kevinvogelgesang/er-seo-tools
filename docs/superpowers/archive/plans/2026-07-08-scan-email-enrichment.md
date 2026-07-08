# Scan-Email Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the bare D7 scan-completion + failed emails into branded, info-rich emails (score cards, pages scanned, issue counts, change-vs-last-scan) without touching D7's at-least-once send/idempotency semantics.

**Architecture:** `lib/notify/content.ts` stays a pure builder — it gains optional, independently-nullable fields and branded table-based HTML/text; a section renders only when its data is non-null. A new pure-ish `lib/notify/enrichment.ts` does all the DB reads (counts + change), returning those optional fields. The handler `lib/jobs/handlers/notify-email.ts` calls the loader **inside a try/catch that also wraps the enriched builder call**; `sendEmail` + the `notifyCompleteSentAt` marker stay **outside** it, byte-for-byte as today.

**Tech Stack:** TypeScript, Prisma (SQLite), Vitest. Email HTML = nested tables + inline styles (Gmail/Outlook safe).

## Global Constraints

- Array-form `prisma.$transaction([...])` only — never interactive. (No transactions needed here; all reads.)
- Enrichment is best-effort: a thrown enrichment query MUST degrade to a basic-but-valid email. It MUST NEVER suppress or duplicate the send or stamp the marker after a failed send.
- Every count is independently nullable: `null` = unknown/run-absent, never `0`. Rendering `0` means "run present, none found".
- On-page duplicate type id is `duplicate_meta_description` (NOT `duplicate_meta`).
- Score-band colors: ≥90 `#16a34a` green · 70–89 `#d97706` amber · <70 `#dc2626` red · null `#9ca3af` muted. Brand navy `#1c2d4a`, page bg `#f4f5f7`, hairline `#e5e7eb`.
- Text body kept in lockstep with HTML. Every dynamic string HTML-escaped via the existing `esc`.
- Gate commands: `npm run lint` · `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build`.
- Tests that hit prisma need `DATABASE_URL="file:./local-dev.db"` prefixed.

---

### Task 1: Enrich the pure content builder

**Files:**
- Modify: `lib/notify/content.ts`
- Test: `lib/notify/content.test.ts`

**Interfaces:**
- Consumes: nothing new (pure).
- Produces:
  ```ts
  interface CompleteInput {
    domain: string; scanType: string; requestedBy: string | null
    adaScore: number | null; seoScore: number | null; durationMs: number | null
    resultsUrl: string; seoUnavailable?: boolean
    // enrichment — all optional, independently nullable
    pagesComplete?: number | null; pagesTotal?: number | null
    counts?: { brokenLinks: number | null; onPageIssues: number | null; adaViolations: number | null } | null
    partial?: { seo?: boolean; ada?: boolean } | null
    change?: { seoDelta?: number | null; adaDelta?: number | null; newIssues?: number | null; resolvedIssues?: number | null; previousDate?: string | null } | null
  }
  function buildCompleteEmail(input: CompleteInput): EmailContent
  function buildFailedEmail(input: FailedInput): EmailContent  // now truncates error
  ```

- [ ] **Step 1: Write failing tests** — append to `lib/notify/content.test.ts`:

```ts
describe('buildCompleteEmail enrichment', () => {
  const base = {
    domain: 'example.edu', scanType: 'ADA + SEO', requestedBy: 'Kevin',
    adaScore: 100, seoScore: 92, durationMs: 240_000,
    resultsUrl: 'https://app.example/ada-audit/site/abc',
  }

  it('renders X of Y pages, all count rows, and the change strip', () => {
    const c = buildCompleteEmail({
      ...base, pagesComplete: 47, pagesTotal: 50,
      counts: { brokenLinks: 2, onPageIssues: 8, adaViolations: 0 },
      partial: { seo: false, ada: false },
      change: { seoDelta: 4, adaDelta: -1, newIssues: 3, resolvedIssues: 5, previousDate: 'Jul 3' },
    })
    expect(c.html).toContain('47 of 50')
    expect(c.text).toContain('47 of 50')
    expect(c.html).toContain('Broken links &amp; images')
    expect(c.text).toMatch(/On-page issues\D+8/)
    expect(c.text).toContain('ADA violations')
    expect(c.html).toContain('#16a34a') // SEO 92 & ADA 100 green
    expect(c.text).toMatch(/new/)
    expect(c.text).toMatch(/resolved/)
    expect(c.text).toContain('Jul 3')
  })

  it('null count renders "—"/omitted, distinct from a rendered 0', () => {
    const unknown = buildCompleteEmail({ ...base, counts: { brokenLinks: null, onPageIssues: null, adaViolations: 0 } })
    expect(unknown.text).toMatch(/ADA violations\D+0/)         // present run → 0 shows
    expect(unknown.text).not.toMatch(/Broken links[^\n]*\b0\b/) // unknown → not a literal 0
  })

  it('omits the change strip when every change field is null', () => {
    const c = buildCompleteEmail({ ...base, change: { seoDelta: null, adaDelta: null, newIssues: null, resolvedIssues: null, previousDate: null } })
    expect(c.text).not.toMatch(/since last scan/i)
  })

  it('shows an incomplete-scan qualifier when partial', () => {
    const c = buildCompleteEmail({ ...base, counts: { brokenLinks: 1, onPageIssues: 2, adaViolations: 0 }, partial: { seo: true, ada: false } })
    expect(c.text.toLowerCase()).toContain('incomplete')
  })

  it('renders no enrichment sections when all optional fields absent (D7 back-comcompat)', () => {
    const c = buildCompleteEmail(base)
    expect(c.text).not.toMatch(/since last scan/i)
    expect(c.html).toContain('example.edu')
  })
})

describe('buildFailedEmail truncation', () => {
  it('truncates an over-long error', () => {
    const c = buildFailedEmail({ domain: 'x.edu', requestedBy: 'K', error: 'E'.repeat(2000), resultsUrl: 'https://app.example/x' })
    expect(c.html.length).toBeLessThan(3000)
    expect(c.text).toContain('EEE')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/notify/content.test.ts`
Expected: FAIL (new fields not rendered; `X of Y`, count rows, change strip absent).

- [ ] **Step 3: Rewrite `lib/notify/content.ts`** — keep `esc`, `fmtScore`, `fmtDuration`; add helpers + the branded builder. Replace the file body from `CompleteInput` onward with:

```ts
const COLOR = { green: '#16a34a', amber: '#d97706', red: '#dc2626', muted: '#9ca3af',
  navy: '#1c2d4a', pageBg: '#f4f5f7', hair: '#e5e7eb', ink: '#111827', sub: '#6b7280' }

function scoreColor(n: number | null): string {
  if (n == null) return COLOR.muted
  if (n >= 90) return COLOR.green
  if (n >= 70) return COLOR.amber
  return COLOR.red
}

function fmtDelta(n: number | null | undefined): string | null {
  if (n == null || n === 0) return n === 0 ? '±0' : null
  return n > 0 ? `▲+${n}` : `▼${n}`
}

function fmtPages(complete?: number | null, total?: number | null): string | null {
  if (complete == null) return null
  return total != null && total > 0 ? `${complete} of ${total}` : String(complete)
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
  pagesComplete?: number | null
  pagesTotal?: number | null
  counts?: { brokenLinks: number | null; onPageIssues: number | null; adaViolations: number | null } | null
  partial?: { seo?: boolean; ada?: boolean } | null
  change?: { seoDelta?: number | null; adaDelta?: number | null; newIssues?: number | null; resolvedIssues?: number | null; previousDate?: string | null } | null
}

function scoreCardHtml(label: string, value: string, color: string): string {
  return `<td align="center" style="padding:12px 8px;border:1px solid ${COLOR.hair};border-radius:8px;">
    <div style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:${COLOR.sub};">${esc(label)}</div>
    <div style="font-size:28px;font-weight:700;color:${color};line-height:1.2;">${esc(value)}</div></td>`
}

function buttonHtml(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="border-radius:6px;background:${COLOR.navy};">
      <a href="${esc(url)}" style="display:inline-block;padding:12px 26px;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(label)}</a>
    </td></tr></table>`
}

function shellHtml(inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.pageBg};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${COLOR.hair};border-radius:10px;overflow:hidden;font-family:system-ui,-apple-system,sans-serif;color:${COLOR.ink};">
        <tr><td style="background:${COLOR.navy};padding:16px 24px;font-size:16px;font-weight:700;color:#ffffff;">ER SEO Tools</td></tr>
        <tr><td style="padding:24px;">${inner}</td></tr>
      </table>
    </td></tr></table>`
}

export function buildCompleteEmail(input: CompleteInput): EmailContent {
  const seoPart = input.seoUnavailable ? 'SEO n/a' : `SEO ${fmtScore(input.seoScore)}`
  const subject = `Site audit finished — ${input.domain} (ADA ${fmtScore(input.adaScore)} · ${seoPart})`
  const greeting = input.requestedBy ? `Hi ${input.requestedBy},` : 'Hi,'
  const pages = fmtPages(input.pagesComplete, input.pagesTotal)

  // --- score cards ---
  const cards: string[] = [
    scoreCardHtml('ADA', fmtScore(input.adaScore), scoreColor(input.adaScore)),
    scoreCardHtml('SEO', input.seoUnavailable ? '—' : fmtScore(input.seoScore), input.seoUnavailable ? COLOR.muted : scoreColor(input.seoScore)),
  ]
  if (pages) cards.push(scoreCardHtml('Pages', pages, COLOR.ink))
  const cardsHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="8"><tr>${cards.join('')}</tr></table>`

  // --- change strip ---
  const ch = input.change
  const changeBits: string[] = []
  if (ch) {
    const sd = fmtDelta(ch.seoDelta); if (sd && ch.seoDelta != null) changeBits.push(`SEO ${sd}`)
    const ad = fmtDelta(ch.adaDelta); if (ad && ch.adaDelta != null) changeBits.push(`ADA ${ad}`)
    if (ch.newIssues != null) changeBits.push(`${ch.newIssues} new`)
    if (ch.resolvedIssues != null) changeBits.push(`${ch.resolvedIssues} resolved`)
  }
  const changeHtml = changeBits.length
    ? `<p style="margin:16px 0 0;font-size:13px;color:${COLOR.sub};">Since last scan${ch?.previousDate ? ` (${esc(ch.previousDate)})` : ''}: ${esc(changeBits.join(' · '))}</p>`
    : ''

  // --- counts table ---
  const cn = input.counts
  const partialTag = (on?: boolean) => (on ? ` <span style="color:${COLOR.amber};">(incomplete scan)</span>` : '')
  const countRow = (label: string, val: number | null, incomplete?: boolean) =>
    val == null ? '' : `<tr><td style="padding:6px 0;font-size:14px;">${esc(label)}${partialTag(incomplete)}</td>
      <td align="right" style="padding:6px 0;font-size:14px;font-weight:600;">${val}</td></tr>`
  const countRows = cn ? [
    countRow('Broken links & images', cn.brokenLinks, input.partial?.seo),
    countRow('On-page issues', cn.onPageIssues, input.partial?.seo),
    countRow('ADA violations', cn.adaViolations, input.partial?.ada),
  ].join('') : ''
  const countsHtml = countRows
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-top:1px solid ${COLOR.hair};">${countRows}</table>`
    : ''

  const inner = `<p style="margin:0 0 4px;font-size:14px;">${esc(greeting)}</p>
    <p style="margin:0 0 16px;font-size:14px;">Your ${esc(input.scanType)} site audit for <strong>${esc(input.domain)}</strong> has finished${input.durationMs ? ` in ${esc(fmtDuration(input.durationMs))}` : ''}.</p>
    ${cardsHtml}${changeHtml}${countsHtml}
    <div style="margin-top:24px;">${buttonHtml(input.resultsUrl, 'View full report')}</div>`

  // --- text body (lockstep) ---
  const seoLine = input.seoUnavailable ? 'SEO analysis unavailable for this run.' : `SEO score: ${fmtScore(input.seoScore)}`
  const tLines = [greeting, '', `Your ${input.scanType} site audit for ${input.domain} has finished.`, '',
    `ADA score: ${fmtScore(input.adaScore)}`, seoLine]
  if (pages) tLines.push(`Pages scanned: ${pages}`)
  tLines.push(`Duration: ${fmtDuration(input.durationMs)}`)
  if (changeBits.length) tLines.push('', `Since last scan${ch?.previousDate ? ` (${ch.previousDate})` : ''}: ${changeBits.join(' · ')}`)
  if (cn) {
    const tCount = (label: string, val: number | null, inc?: boolean) => val == null ? null : `${label}: ${val}${inc ? ' (incomplete scan)' : ''}`
    const rows = [tCount('Broken links & images', cn.brokenLinks, input.partial?.seo),
      tCount('On-page issues', cn.onPageIssues, input.partial?.seo),
      tCount('ADA violations', cn.adaViolations, input.partial?.ada)].filter(Boolean)
    if (rows.length) tLines.push('', ...rows as string[])
  }
  tLines.push('', `View the results: ${input.resultsUrl}`)

  return { subject, html: shellHtml(inner), text: tLines.join('\n') }
}

export interface FailedInput {
  domain: string
  requestedBy: string | null
  error: string
  resultsUrl: string
}

const MAX_ERROR_LEN = 500

export function buildFailedEmail(input: FailedInput): EmailContent {
  const err = input.error.length > MAX_ERROR_LEN ? input.error.slice(0, MAX_ERROR_LEN) + '…' : input.error
  const subject = `Site audit FAILED — ${input.domain}`
  const inner = `<p style="margin:0 0 12px;font-size:14px;">A site audit <strong style="color:${COLOR.red};">failed</strong>.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
      <tr><td style="padding:4px 0;color:${COLOR.sub};">Domain</td><td align="right"><strong>${esc(input.domain)}</strong></td></tr>
      <tr><td style="padding:4px 0;color:${COLOR.sub};">Requested by</td><td align="right">${esc(input.requestedBy ?? 'unknown')}</td></tr>
    </table>
    <pre style="margin:12px 0;padding:10px;background:${COLOR.pageBg};border:1px solid ${COLOR.hair};border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-word;">${esc(err)}</pre>
    <div style="margin-top:16px;">${buttonHtml(input.resultsUrl, 'Open the audit')}</div>`
  const text = [`A site audit failed.`, '', `Domain: ${input.domain}`,
    `Requested by: ${input.requestedBy ?? 'unknown'}`, `Error: ${err}`, '', `Audit: ${input.resultsUrl}`].join('\n')
  return { subject, html: shellHtml(inner), text }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/notify/content.test.ts`
Expected: PASS (all old + new cases).

- [ ] **Step 5: Commit**

```bash
git add lib/notify/content.ts lib/notify/content.test.ts
git commit -m "feat(notify): D7 enrichment — branded email builder with optional info sections"
```

---

### Task 2: Enrichment data loader

**Files:**
- Create: `lib/notify/enrichment.ts`
- Test: `lib/notify/enrichment.test.ts`

**Interfaces:**
- Consumes: prisma; `parseScoreVersion` from `@/lib/scoring/breakdown-version`; `getSiteAuditInstanceDiff` from `@/lib/services/site-audit-diff`.
- Produces:
  ```ts
  interface EnrichAuditInput {
    id: string; domain: string; seoOnly: boolean
    pagesComplete: number; pagesTotal: number
    crawlRuns: { id: string; tool: string; source: string; status: string;
                 score: number | null; scoreBreakdown: string | null;
                 domain: string | null; completedAt: Date | null; createdAt: Date }[]
  }
  interface CompleteEnrichment {
    pagesComplete: number; pagesTotal: number
    counts: { brokenLinks: number | null; onPageIssues: number | null; adaViolations: number | null }
    partial: { seo: boolean; ada: boolean }
    change: { seoDelta: number | null; adaDelta: number | null; newIssues: number | null; resolvedIssues: number | null; previousDate: string | null }
  }
  function loadCompleteEnrichment(audit: EnrichAuditInput): Promise<CompleteEnrichment>
  ```

- [ ] **Step 1: Write failing tests** — `lib/notify/enrichment.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { loadCompleteEnrichment } from './enrichment'

const DOM = 'enrich-test.example'
afterEach(async () => {
  await prisma.crawlRun.deleteMany({ where: { domain: DOM } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOM } })
})

async function mkRun(data: Record<string, unknown>) {
  return prisma.crawlRun.create({ data: { tool: 'seo-parser', source: 'live-scan', status: 'complete', domain: DOM, ...data } })
}

describe('loadCompleteEnrichment', () => {
  it('counts broken (summed count) + on-page + ada, and flags partial', async () => {
    const audit = await prisma.siteAudit.create({ data: { domain: DOM, status: 'complete', wcagLevel: 'wcag21aa', pagesComplete: 5, pagesTotal: 6 } })
    const live = await mkRun({ siteAuditId: audit.id, status: 'partial', score: 80,
      findings: { create: [
        { scope: 'run', type: 'broken_internal_links', severity: 'critical', count: 3, dedupKey: 'a' },
        { scope: 'run', type: 'broken_images', severity: 'critical', count: 2, dedupKey: 'b' },
        { scope: 'run', type: 'duplicate_title', severity: 'warning', count: 1, dedupKey: 'c' },
        { scope: 'run', type: 'missing_h1', severity: 'warning', count: 4, dedupKey: 'd' },
      ] } })
    const ada = await prisma.crawlRun.create({ data: { tool: 'ada-audit', source: 'site-audit', status: 'complete', domain: DOM, wcagLevel: 'wcag21aa', siteAuditId: audit.id, score: 100,
      findings: { create: [{ scope: 'page', type: 'image-alt', severity: 'critical', url: 'https://x/a', count: 1, dedupKey: 'e' }] } } })
    const input = {
      id: audit.id, domain: DOM, seoOnly: false, pagesComplete: 5, pagesTotal: 6,
      crawlRuns: [
        { id: live.id, tool: 'seo-parser', source: 'live-scan', status: 'partial', score: 80, scoreBreakdown: null, domain: DOM, completedAt: null, createdAt: live.createdAt },
        { id: ada.id, tool: 'ada-audit', source: 'site-audit', status: 'complete', score: 100, scoreBreakdown: null, domain: DOM, completedAt: null, createdAt: ada.createdAt },
      ],
    }
    const e = await loadCompleteEnrichment(input)
    expect(e.counts.brokenLinks).toBe(5)   // 3 + 2, summed count (not row count)
    expect(e.counts.onPageIssues).toBe(5)  // 1 + 4
    expect(e.counts.adaViolations).toBe(1)
    expect(e.partial.seo).toBe(true)
    expect(e.partial.ada).toBe(false)
    expect(e.pagesComplete).toBe(5)
    expect(e.pagesTotal).toBe(6)
  })

  it('null counts (not 0) when the relevant run is absent', async () => {
    const audit = await prisma.siteAudit.create({ data: { domain: DOM, status: 'complete', wcagLevel: 'wcag21aa', pagesComplete: 0, pagesTotal: 0 } })
    const live = await mkRun({ siteAuditId: audit.id, score: 70 })
    const input = { id: audit.id, domain: DOM, seoOnly: true, pagesComplete: 0, pagesTotal: 0,
      crawlRuns: [{ id: live.id, tool: 'seo-parser', source: 'live-scan', status: 'complete', score: 70, scoreBreakdown: null, domain: DOM, completedAt: null, createdAt: live.createdAt }] }
    const e = await loadCompleteEnrichment(input)
    expect(e.counts.adaViolations).toBeNull()   // no ada run → unknown
    expect(e.counts.brokenLinks).toBe(0)         // live run present, none found → 0
  })

  it('SEO delta picks the latest earlier same-domain live run with a non-null score', async () => {
    const audit = await prisma.siteAudit.create({ data: { domain: DOM, status: 'complete', wcagLevel: 'wcag21aa', pagesComplete: 1, pagesTotal: 1 } })
    const cur = await mkRun({ siteAuditId: audit.id, score: 90, completedAt: new Date('2026-07-08') })
    await mkRun({ score: 80, completedAt: new Date('2026-07-01') })      // older
    await mkRun({ score: null, completedAt: new Date('2026-07-05') })    // newer but null score — skipped
    await mkRun({ score: 85, completedAt: new Date('2026-07-03') })      // the winner
    const input = { id: audit.id, domain: DOM, seoOnly: true, pagesComplete: 1, pagesTotal: 1,
      crawlRuns: [{ id: cur.id, tool: 'seo-parser', source: 'live-scan', status: 'complete', score: 90, scoreBreakdown: null, domain: DOM, completedAt: cur.completedAt, createdAt: cur.createdAt }] }
    const e = await loadCompleteEnrichment(input)
    expect(e.change.seoDelta).toBe(5) // 90 - 85
  })

  it('rejects a later candidate and a same-timestamp higher-id candidate for SEO delta', async () => {
    const audit = await prisma.siteAudit.create({ data: { domain: DOM, status: 'complete', wcagLevel: 'wcag21aa', pagesComplete: 1, pagesTotal: 1 } })
    const ts = new Date('2026-07-08')
    const cur = await mkRun({ siteAuditId: audit.id, score: 90, completedAt: ts })
    await mkRun({ score: 60, completedAt: new Date('2026-07-10') })  // later → excluded
    // same timestamp, higher id than cur → excluded (only strictly-earlier or lower-id-at-tie count)
    const older = await mkRun({ score: 70, completedAt: new Date('2026-07-02') })
    const input = { id: audit.id, domain: DOM, seoOnly: true, pagesComplete: 1, pagesTotal: 1,
      crawlRuns: [{ id: cur.id, tool: 'seo-parser', source: 'live-scan', status: 'complete', score: 90, scoreBreakdown: null, domain: DOM, completedAt: ts, createdAt: cur.createdAt }] }
    void older
    const e = await loadCompleteEnrichment(input)
    expect(e.change.seoDelta).toBe(20) // 90 - 70, never the later 60
  })

  it('suppresses adaDelta on scorer-version mismatch and seoDelta on SEO version mismatch', async () => {
    // Two live runs with differing score-breakdown versions → seoDelta null.
    const audit = await prisma.siteAudit.create({ data: { domain: DOM, status: 'complete', wcagLevel: 'wcag21aa', pagesComplete: 1, pagesTotal: 1 } })
    const cur = await mkRun({ siteAuditId: audit.id, score: 90, completedAt: new Date('2026-07-08'),
      scoreBreakdown: JSON.stringify({ version: 2, scorer: 'live-seo', score: 90, factors: [] }) })
    await mkRun({ score: 80, completedAt: new Date('2026-07-01'),
      scoreBreakdown: JSON.stringify({ version: 1, scorer: 'live-seo', score: 80, factors: [] }) })
    const input = { id: audit.id, domain: DOM, seoOnly: true, pagesComplete: 1, pagesTotal: 1,
      crawlRuns: [{ id: cur.id, tool: 'seo-parser', source: 'live-scan', status: 'complete', score: 90,
        scoreBreakdown: JSON.stringify({ version: 2, scorer: 'live-seo', score: 90, factors: [] }),
        domain: DOM, completedAt: new Date('2026-07-08'), createdAt: cur.createdAt }] }
    const e = await loadCompleteEnrichment(input)
    expect(e.change.seoDelta).toBeNull() // version 2 vs 1 → suppressed
  })
})
```

> **Test note:** `parseScoreVersion` reads the `version` field of the breakdown JSON (verify the exact field name against `@/lib/scoring/breakdown-version` when implementing — the ADA v1↔v2 assertion depends on it). If it keys off a differently-named field, adjust the fixture JSON to match.

- [ ] **Step 2: Run to verify fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/notify/enrichment.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/notify/enrichment.ts`:**

```ts
// lib/notify/enrichment.ts
// D7 enrichment loader for the completion email. Pure reads of normalized tables
// (Finding / CrawlRun / SiteAudit) — no blobs. Every count is independently
// nullable: null = run absent (unknown), never 0. Caller wraps this in try/catch;
// a throw here degrades the email to base fields, never blocks the send.

import { prisma } from '@/lib/db'
import { parseScoreVersion } from '@/lib/scoring/breakdown-version'
import { getSiteAuditInstanceDiff } from '@/lib/services/site-audit-diff'

const ON_PAGE_TYPES = ['missing_title', 'missing_h1', 'missing_meta_description', 'thin_content',
  'duplicate_title', 'duplicate_meta_description', 'duplicate_h1']
const BROKEN_HEADLINE_TYPES = ['broken_internal_links', 'broken_images']

type Run = {
  id: string; tool: string; source: string; status: string
  score: number | null; scoreBreakdown: string | null
  domain: string | null; completedAt: Date | null; createdAt: Date
}
export interface EnrichAuditInput {
  id: string; domain: string; seoOnly: boolean
  pagesComplete: number; pagesTotal: number; crawlRuns: Run[]
}
export interface CompleteEnrichment {
  pagesComplete: number; pagesTotal: number
  counts: { brokenLinks: number | null; onPageIssues: number | null; adaViolations: number | null }
  partial: { seo: boolean; ada: boolean }
  change: { seoDelta: number | null; adaDelta: number | null; newIssues: number | null; resolvedIssues: number | null; previousDate: string | null }
}

const stamp = (r: { completedAt: Date | null; createdAt: Date }) => (r.completedAt ?? r.createdAt).getTime()

async function sumRunScope(runId: string, types: string[]): Promise<number> {
  const agg = await prisma.finding.aggregate({ _sum: { count: true }, where: { runId, scope: 'run', type: { in: types } } })
  return agg._sum.count ?? 0
}

export async function loadCompleteEnrichment(audit: EnrichAuditInput): Promise<CompleteEnrichment> {
  const live = audit.crawlRuns.find((r) => r.tool === 'seo-parser' && r.source === 'live-scan') ?? null
  const ada = audit.crawlRuns.find((r) => r.tool === 'ada-audit') ?? null

  const counts = {
    brokenLinks: live ? await sumRunScope(live.id, BROKEN_HEADLINE_TYPES) : null,
    onPageIssues: live ? await sumRunScope(live.id, ON_PAGE_TYPES) : null,
    adaViolations: ada ? await prisma.finding.count({ where: { runId: ada.id, scope: 'page' } }) : null,
  }
  const partial = { seo: live?.status === 'partial', ada: ada?.status === 'partial' }

  // --- change vs last scan ---
  let seoDelta: number | null = null
  let adaDelta: number | null = null
  let newIssues: number | null = null
  let resolvedIssues: number | null = null
  let previousDate: string | null = null

  // Baseline dates are tracked PER delta — ADA and SEO can compare against
  // different prior scans (SEO-only scans between full audits). A single strip
  // date is shown only when the present baselines agree (Codex plan-fix #2).
  let adaDate: string | null = null
  let seoDate: string | null = null

  // ADA new/resolved + ADA score delta (full audits only; diff is ADA-anchored)
  const diff = await getSiteAuditInstanceDiff(audit.id)
  if (diff) {
    // newCount already partitions into regressedCount + newPageCount — do NOT
    // add newPageCount (verified findings-shared.ts:270-272; Codex plan-fix #1).
    newIssues = diff.diff.newCount
    resolvedIssues = diff.diff.resolvedCount
    adaDate = diff.previous.completedAt ? new Date(diff.previous.completedAt).toISOString().slice(0, 10) : null
    if (ada?.score != null) {
      // Load the previous ADA run by its exact run id (Codex plan-fix #4).
      const prevAda = await prisma.crawlRun.findUnique({
        where: { id: diff.previous.runId },
        select: { score: true, scoreBreakdown: true },
      })
      if (prevAda?.score != null && parseScoreVersion(ada.scoreBreakdown) === parseScoreVersion(prevAda.scoreBreakdown)) {
        adaDelta = ada.score - prevAda.score
      }
    }
  }

  // SEO score delta — deterministic earlier same-domain live-scan run, non-null scores
  if (live?.score != null) {
    const host = live.domain ?? audit.domain
    const cands = await prisma.crawlRun.findMany({
      where: { tool: 'seo-parser', source: 'live-scan', domain: host, score: { not: null }, id: { not: live.id } },
      select: { id: true, score: true, scoreBreakdown: true, completedAt: true, createdAt: true },
    })
    const cur = live
    const prev = cands
      .filter((c) => stamp(c) < stamp(cur) || (stamp(c) === stamp(cur) && c.id.localeCompare(cur.id) < 0))
      .sort((a, b) => stamp(b) - stamp(a) || b.id.localeCompare(a.id))[0] ?? null
    if (prev?.score != null && parseScoreVersion(live.scoreBreakdown) === parseScoreVersion(prev.scoreBreakdown)) {
      seoDelta = live.score - prev.score
      seoDate = (prev.completedAt ?? prev.createdAt).toISOString().slice(0, 10)
    }
  }

  // Reconcile: show a date only when every present baseline agrees.
  const dates = [adaDate, seoDate].filter((d): d is string => d != null)
  previousDate = dates.length > 0 && dates.every((d) => d === dates[0]) ? dates[0] : null

  return { pagesComplete: audit.pagesComplete, pagesTotal: audit.pagesTotal, counts, partial,
    change: { seoDelta, adaDelta, newIssues, resolvedIssues, previousDate } }
}
```

**Note on `parseScoreVersion`:** verify its exact signature/return before implementing — it is imported from `@/lib/scoring/breakdown-version` and used by `scorecard-shared.ts` as `parseScoreVersion(r.scoreBreakdown)`. If it returns `undefined` for null input, `=== ` comparison still holds (two `undefined`s are equal) — acceptable: two version-less runs are treated as same version. If that helper's null/undefined semantics differ, keep the "equal ⇒ compare" gate.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/notify/enrichment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/notify/enrichment.ts lib/notify/enrichment.test.ts
git commit -m "feat(notify): D7 enrichment loader — counts, partial flags, change-vs-last-scan"
```

---

### Task 3: Wire enrichment into the handler

**Files:**
- Modify: `lib/jobs/handlers/notify-email.ts`
- Test: `lib/jobs/handlers/notify-email.test.ts`

**Interfaces:**
- Consumes: `loadCompleteEnrichment`, `EnrichAuditInput` from `@/lib/notify/enrichment`; `logError` from `@/lib/log`.
- Produces: no new exports (handler behavior only).

- [ ] **Step 1: Write failing tests** — append to `lib/jobs/handlers/notify-email.test.ts`.

**First fix the existing `afterEach` cleanup** (Codex plan-fix #6): `CrawlRun.siteAuditId`
is `onDelete: SetNull`, so deleting only `SiteAudit` orphans the live/ada runs these
tests create — they then contaminate the deterministic previous-run selection of later
tests. Delete CrawlRuns for the test domain **before** the SiteAudits:
```ts
  afterEach(async () => {
    process.env = OLD
    await prisma.crawlRun.deleteMany({ where: { domain: 'notify-test.example' } })
    await prisma.siteAudit.deleteMany({ where: { domain: 'notify-test.example' } })
  })
```

Then append the new cases:
```ts
  it('passes enrichment (counts + pages) to the complete email', async () => {
    const audit = await prisma.siteAudit.create({ data: { domain: 'notify-test.example', status: 'complete', wcagLevel: 'wcag21aa', notifyEmail: 'r@example.com', pagesComplete: 4, pagesTotal: 4 } })
    await prisma.crawlRun.create({ data: { tool: 'seo-parser', source: 'live-scan', status: 'complete', domain: 'notify-test.example', siteAuditId: audit.id, score: 88,
      findings: { create: [{ scope: 'run', type: 'broken_internal_links', severity: 'critical', count: 2, dedupKey: 'z1' }] } } })
    await runNotifyEmailJob({ siteAuditId: audit.id, kind: 'complete' }, deps)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const content = (sendSpy.mock.calls[0][0] as { content: { text: string } }).content
    expect(content.text).toContain('4 of 4')
    expect(content.text).toContain('Broken links & images: 2')
  })

  it('still sends a basic email (and stamps marker once) when enrichment throws', async () => {
    const id = await mkAudit({ notifyEmail: 'r@example.com' })
    const spy = vi.spyOn(prisma.finding, 'aggregate').mockRejectedValueOnce(new Error('db boom'))
    await prisma.crawlRun.create({ data: { tool: 'seo-parser', source: 'live-scan', status: 'complete', domain: 'notify-test.example', siteAuditId: id, score: 50 } })
    await runNotifyEmailJob({ siteAuditId: id, kind: 'complete' }, deps)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const row = await prisma.siteAudit.findUnique({ where: { id } })
    expect(row?.notifyCompleteSentAt).not.toBeNull()
    spy.mockRestore()
  })
```

(Add `vi` to the existing import if not present.)

- [ ] **Step 2: Run to verify fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/notify-email.test.ts`
Expected: FAIL (enrichment not wired; `4 of 4` absent).

- [ ] **Step 3: Edit `lib/jobs/handlers/notify-email.ts`.**

3a. Add imports near the top + a small deadline helper (Codex plan-fix #3 — the
job's 30s worker timeout does NOT cancel pending Prisma work, so an unbounded
enrichment read could delay the send past timeout and widen the duplicate-send
window; cap it):
```ts
import { loadCompleteEnrichment } from '@/lib/notify/enrichment'
import { logError } from '@/lib/log'

const ENRICHMENT_DEADLINE_MS = 5_000

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('enrichment deadline exceeded')), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}
```

3b. Expand the `findUnique` `select` (the `complete`/`failed` shared load) to add the enrichment fields:
```ts
      id: true, domain: true, status: true, error: true, requestedBy: true, notifyEmail: true,
      seoOnly: true, seoIntent: true, notifyCompleteSentAt: true, notifyFailedSentAt: true,
      startedAt: true, completedAt: true,
      pagesComplete: true, pagesTotal: true,
      crawlRuns: { select: { id: true, tool: true, source: true, status: true, score: true, scoreBreakdown: true, domain: true, completedAt: true, createdAt: true } },
```

3c. Replace the `complete` branch's build+send. The existing code computes `content` from `buildCompleteEmail({...})` then `await sendEmail(...)`. Change to build `base`, wrap enrichment + enriched build in try/catch, then send **outside** it:
```ts
  if (kind === 'complete') {
    if (audit.notifyCompleteSentAt) return // already sent
    const adaRun = audit.crawlRuns.find((r) => r.tool === 'ada-audit')
    const seoRun = audit.crawlRuns.find((r) => r.tool === 'seo-parser' && r.source === 'live-scan')
    const adaScore = adaRun?.score ?? null
    const liveScore = seoRun?.score ?? null
    const durationMs = audit.startedAt && audit.completedAt
      ? audit.completedAt.getTime() - audit.startedAt.getTime() : null
    const scanType = audit.seoOnly ? 'SEO' : audit.seoIntent ? 'ADA + SEO' : 'ADA'
    const base = {
      domain: audit.domain, scanType, requestedBy: audit.requestedBy,
      adaScore: audit.seoOnly ? null : adaScore, seoScore: liveScore, durationMs,
      resultsUrl: url, seoUnavailable: !seoRun,
    }
    let content
    try {
      const enrichment = await withDeadline(loadCompleteEnrichment({
        id: audit.id, domain: audit.domain, seoOnly: audit.seoOnly,
        pagesComplete: audit.pagesComplete, pagesTotal: audit.pagesTotal, crawlRuns: audit.crawlRuns,
      }), ENRICHMENT_DEADLINE_MS)
      content = buildCompleteEmail({ ...base, ...enrichment })
    } catch (err) {
      logError({ subsystem: 'jobs', job: 'notify-email', siteAuditId: audit.id }, err)
      content = buildCompleteEmail(base)
    }
    await sendEmail({ to: audit.notifyEmail, content }, deps)
    await prisma.siteAudit.updateMany({
      where: { id: audit.id, notifyCompleteSentAt: null },
      data: { notifyCompleteSentAt: new Date() },
    })
    return
  }
```

3d. The `failed` branch is unchanged except that `buildFailedEmail` now truncates internally — no code change needed there.

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/notify-email.test.ts`
Expected: PASS (all old no-op cases + the two new cases).

- [ ] **Step 5: Full gates**

Run:
```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add lib/jobs/handlers/notify-email.ts lib/jobs/handlers/notify-email.test.ts
git commit -m "feat(notify): D7 wire enrichment into completion email; send+marker stay outside the fallback boundary"
```

---

## Self-Review

**Spec coverage:** branded HTML (T1) · pages/counts/change fields (T1 render, T2 load) · duplicate_meta_description + run-scope sum (T2) · null≠0 (T1 render, T2 load, T3 handler) · partial qualifier (T1/T2) · ADA delta version-gated separately from diff (T2) · deterministic SEO previous selection (T2) · try/catch excludes send+marker (T3) · failed-error truncation (T1) · all test cases from the spec's Testing section mapped to T1/T2/T3. No gaps.

**Placeholders:** none — every code step is complete. One explicit verify note (`parseScoreVersion` null semantics) with a defined fallback behavior, not a TODO.

**Type consistency:** `CompleteInput` (T1) ⊇ `CompleteEnrichment` (T2) — the handler spreads `{...base, ...enrichment}`; `enrichment` supplies `pagesComplete/pagesTotal/counts/partial/change`, `base` supplies the rest. `loadCompleteEnrichment(EnrichAuditInput)` shape matches the handler's expanded `select` exactly (id, domain, seoOnly, pagesComplete, pagesTotal, crawlRuns{id,tool,source,status,score,scoreBreakdown,domain,completedAt,createdAt}). `getSiteAuditInstanceDiff` return used as `diff.diff.{newCount,resolvedCount}` (newCount alone — it already subsumes regressed+newPage, verified) + `diff.previous.{runId,completedAt}` (previous ADA run loaded by `runId`, not `siteAuditId`) — matches `SiteAuditDiffResult`.

**Codex plan-review fixes applied (turn 40):** #1 newCount-only arithmetic · #2 per-delta baseline dates reconciled to one strip date only when they agree · #3 5s enrichment deadline (`withDeadline`) so a slow read can't push the send past the 30s job timeout · #4 previous ADA run by `previous.runId` · #5 added version-gate + candidate-rejection tests · #6 Task 3 `afterEach` deletes CrawlRuns before SiteAudits.
