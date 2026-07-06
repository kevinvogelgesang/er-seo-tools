# Slack Alert Enrichment — Design

**Date:** 2026-07-06
**Status:** Approved by Kevin (conversation); Codex-reviewed (accept-with-fixes, all applied)

## Problem

The D0 `health-alert` job (15-min cadence) posts terse aggregate lines to
`ALERT_WEBHOOK_URL`:

```
:rotating_light: er-seo-tools alert (https://…)
• 3 audit(s) errored since last check
• 1 durable job(s) exhausted retries
```

The error messages and scan IDs already exist on the rows
(`SiteAudit.error`, `AdaAudit.error`, `Job.lastError`) but the alert only
counts them. Kevin has to SSH/log-grep or open the app to find out *what*
failed. The alert should carry the actual error text and a clickable link to
the scan it came from.

## Decisions (made with Kevin)

1. **Scope: all four signals** get enrichment — errored site audits, errored
   ADA audits, exhausted jobs, and the stalled-audit line. Backup-stale line
   unchanged.
2. **Format: Slack mrkdwn in the existing `{text}` payload** — clickable
   `<url|label>` links, one line per item. No Block Kit; `sendAlert` payload
   shape unchanged.

## Approach

Enrich the signals layer (keeps the existing "DB collection vs pure decision
logic" split in `lib/ops/health-check.ts`):

- `collectHealthSignals` fetches capped detail rows alongside the existing
  counts.
- The pure `evaluateHealth` renders the mrkdwn lines — unit-testable without
  a DB.

Rejected alternatives: a second query pass in `runHealthAlert` (duplicates
time-windowing, splits rendering across files); Block Kit (couples payload to
Slack, more code, ruled out by decision 2).

## Detailed design

### `HealthSignals` gains detail arrays

Fetched with `findMany`, `take: 5`, same `since` windows as the counts, and
**ordered by the same field each count filters on** (Codex fix 1):

- `SiteAudit`: `where { status: 'error', updatedAt > since }`, `orderBy updatedAt desc`
- `AdaAudit`: `where { status: 'error', completedAt > since }`, `orderBy completedAt desc` (AdaAudit has no `updatedAt`; error paths set `completedAt`)
- `Job`: `where { status: 'error', updatedAt > since }`, `orderBy updatedAt desc`

The `count()` queries stay for accurate totals:

```ts
erroredSiteAuditDetails: { id: string; domain: string; error: string | null }[]
erroredAdaAuditDetails:  { id: string; url: string; error: string | null; siteAuditId: string | null }[]
exhaustedJobDetails:     { id: string; type: string; lastError: string | null; groupKey: string | null }[]
```

### `evaluateHealth` renders per-item lines

- Site audit:
  `• Site audit *acme.edu* errored: \`Navigation timeout…\` — <APP_URL/ada-audit/site/<id>|View scan>`
- ADA audit: same shape, labelled by `url`. Link target depends on origin:
  - **child** row (`siteAuditId` set) → parent results page
    `/ada-audit/site/<siteAuditId>` (that's where triage happens)
  - **standalone** row → `/ada-audit/<id>`
- Exhausted job: `• Job \`psi\` exhausted retries: \`PSI 429…\``. When
  `groupKey` is `site-audit:<id>` or `ada-audit:<id>`, opportunistically
  append a link to that scan (`/ada-audit/site/<id>` / `/ada-audit/<id>`);
  other jobs stay unlinked (Codex fix 6).
- Stalled audit: existing line + ` — <…/ada-audit/site/<id>|View scan>`.
- **Counts remain the source of alert presence** (Codex fix 2): a category
  alerts whenever its `count > 0`, even if the detail array is unexpectedly
  empty (race/data drift) — in that case fall back to today's aggregate
  count line. Overflow is `count - details.length`: when positive, append
  `  …and N more` for that category. This keeps the `/api/health` degraded
  flag count-driven.
- Error text hygiene, **in this order** (Codex fix 3): collapse newlines to
  spaces → truncate to 140 chars (with `…`) → neutralize backticks (`` ` ``
  → `'`, so text can't break out of the code span) → mrkdwn-escape (`&` →
  `&amp;`, `<` → `&lt;`, `>` → `&gt;`) so error strings can't inject fake
  links. (Truncating before escaping means entities are never cut mid-way.)
  Null/empty error → `(no error message)`.
- Display labels (domains, URLs) are truncated separately at 60 chars
  (Codex fix 5) — link *targets* are never truncated, only the visible
  label. Job types are short constants; no cap needed.

### Link base URL

`EvalOpts` gains `appUrl: string | null`, populated in `healthEvalOpts()`
from `NEXT_PUBLIC_APP_URL` (never request origin — house rule), **validated
and normalized** (Codex fix 4): must parse as an absolute `http(s)` URL
(`new URL(...)`), trailing slash stripped; links are built with URL
construction, not string concatenation. Unset or invalid → `appUrl: null`
and lines render without links (plain text, no broken `<|>` syntax).

### Unchanged

- `sendAlert` (`lib/ops/alert-webhook.ts`) — payload stays `{ text }`,
  timeout/never-throw semantics untouched.
- Dedup/cooldown state machine and commit-rule in `runHealthAlert`.
- Aggregate count semantics (child ADA audits still counted as today).
- Backup-stale line, header line, 15-min cadence.

## Testing

- Extend `lib/ops/health-check.test.ts` (pure `evaluateHealth`): rendered
  lines include error text + correct link targets; child-vs-standalone ADA
  link routing; job `groupKey` link routing (site-audit / ada-audit / other);
  truncation + newline collapse + backtick neutralization + mrkdwn escaping
  (and their order); label truncation; overflow line; count>0 with empty
  detail array still alerts (aggregate fallback); `appUrl: null` or invalid
  renders link-free lines; cooldown behavior unchanged.
- Extend `collectHealthSignals` coverage: detail arrays respect the `since`
  window and the `take: 5` cap.
- `lib/jobs/handlers/health-alert.test.ts`: message assembly still works;
  commit-rule untouched.
- Prod verification (Codex): one real Slack test message whose error text
  contains `<`, `>`, `&`, backticks, and newlines, confirming rendering and
  that links resolve against the deployed `NEXT_PUBLIC_APP_URL`.

## Out of scope

- Block Kit / interactive buttons.
- New alert categories or threshold changes.
- Alerting on individual child-page errors beyond today's count semantics.
- Any change to `/api/health` or `/admin/ops` behavior. Note: both DO reach
  `evaluateHealth` via `computeHealthAlerts` (`lib/ops/health-summary.ts`),
  but they consume only `alerts.length` (degraded flag) — verified in
  `ops-snapshot.ts` and `getLivenessSummary`. The rendered strings go only to
  Slack, so mrkdwn in the lines is safe. The degraded flag stays
  `length > 0`, alert presence stays count-driven (Codex fix 2), so the
  flag's semantics are unchanged. `collectHealthSignals` gains three
  `take: 5` queries (status is indexed; there is no compound
  `status+updatedAt` index, but a 5-row scan over errored rows behind the
  10 s-TTL-cached public health poll is negligible — Codex fix 7).
