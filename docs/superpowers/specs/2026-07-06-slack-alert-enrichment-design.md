# Slack Alert Enrichment — Design

**Date:** 2026-07-06
**Status:** Approved by Kevin (conversation), pending Codex review

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

Fetched with `findMany`, `take: 5`, newest first (same `since` windows as the
counts; the `count()` queries stay for accurate totals):

```ts
erroredSiteAuditDetails: { id: string; domain: string; error: string | null }[]
erroredAdaAuditDetails:  { id: string; url: string; error: string | null; siteAuditId: string | null }[]
exhaustedJobDetails:     { id: string; type: string; lastError: string | null }[]
```

### `evaluateHealth` renders per-item lines

- Site audit:
  `• Site audit *acme.edu* errored: \`Navigation timeout…\` — <APP_URL/ada-audit/site/<id>|View scan>`
- ADA audit: same shape, labelled by `url`. Link target depends on origin:
  - **child** row (`siteAuditId` set) → parent results page
    `/ada-audit/site/<siteAuditId>` (that's where triage happens)
  - **standalone** row → `/ada-audit/<id>`
- Exhausted job: `• Job \`psi\` exhausted retries: \`PSI 429…\`` — no scan
  page to link.
- Stalled audit: existing line + ` — <…/ada-audit/site/<id>|View scan>`.
- Overflow: when a count exceeds its 5 detailed items, append
  `  …and N more` for that category.
- Error text hygiene: newlines collapsed to spaces, truncated to 140 chars
  (with `…`), Slack mrkdwn-escaped (`&` → `&amp;`, `<` → `&lt;`, `>` →
  `&gt;`) so error strings can't inject fake links. Null/empty error →
  `(no error message)`.

### Link base URL

`EvalOpts` gains `appUrl: string | null`, populated in `healthEvalOpts()`
from `NEXT_PUBLIC_APP_URL` (never request origin — house rule). When unset,
lines render without links (plain text, no broken `<|>` syntax).

### Unchanged

- `sendAlert` (`lib/ops/alert-webhook.ts`) — payload stays `{ text }`,
  timeout/never-throw semantics untouched.
- Dedup/cooldown state machine and commit-rule in `runHealthAlert`.
- Aggregate count semantics (child ADA audits still counted as today).
- Backup-stale line, header line, 15-min cadence.

## Testing

- Extend `lib/ops/health-check.test.ts` (pure `evaluateHealth`): rendered
  lines include error text + correct link targets; child-vs-standalone ADA
  link routing; truncation + newline collapse + mrkdwn escaping; overflow
  line; `appUrl: null` renders link-free lines; cooldown behavior unchanged.
- Extend `collectHealthSignals` coverage: detail arrays respect the `since`
  window and the `take: 5` cap.
- `lib/jobs/handlers/health-alert.test.ts`: message assembly still works;
  commit-rule untouched.

## Out of scope

- Block Kit / interactive buttons.
- New alert categories or threshold changes.
- Alerting on individual child-page errors beyond today's count semantics.
- Any change to `/api/health` or `/admin/ops` behavior. Note: both DO reach
  `evaluateHealth` via `computeHealthAlerts` (`lib/ops/health-summary.ts`),
  but they consume only `alerts.length` (degraded flag) — verified in
  `ops-snapshot.ts` and `getLivenessSummary`. The rendered strings go only to
  Slack, so mrkdwn in the lines is safe. The degraded flag stays
  `length > 0`, and enrichment produces ≥1 line exactly when the old code
  produced 1, so the flag's semantics are unchanged. `collectHealthSignals`
  gains three `take: 5` indexed queries, also run by the 10 s-TTL-cached
  public health poll — negligible.
