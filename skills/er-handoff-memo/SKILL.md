---
name: er-handoff-memo
description: |
  Use when the user pastes a clipboard payload from an er-seo-tools dashboard —
  Pillar Analysis, the SEO Parser results page ("Generate Roadmap"), or Keyword
  Research. The payload always has a "Webapp:" line, an "<X> ID:" line, and an
  "Access token: <prefix>_..." line where the prefix is pat_ (pillar strategic
  memo), srt_ (technical-SEO roadmap, with optional Teamwork push), krt_
  (keyword strategy memo), or qct_ (quarter-cycle Teamwork push). Fetches the
  structured export, writes the right document (or, for qct_, creates the
  planned-week Teamwork tasks), and posts the result back to the dashboard.
  Internal use only at Enrollment Resources. Replaces the separate
  pillar-analysis-narrative, seo-audit-roadmap, and keyword-strategy-memo
  skills.
version: 2.1.0
---

# ER Handoff Memo (unified)

One skill for the three er-seo-tools dashboard handoffs. The transport, auth,
and error handling are shared (and **executed**, not re-derived); the document
you write is workflow-specific.

## 1. Activate + route

Activate only when the message contains ALL of:
- a `Webapp:` line with a URL,
- an `<X> ID:` line (`Analysis ID:` / `Roadmap ID:` / `Memo ID:` / `Plan ID:`),
- an `Access token:` line whose value starts with `pat_`, `srt_`, `krt_`, or `qct_`.

If any field is missing, ask the user to re-copy a fresh prompt from the
dashboard. Do not run the flow with partial fields.

**Route by the token prefix** — it is the single source of truth for which
workflow this is:

| Prefix | Workflow | ID label | Document | Template | Teamwork push? |
|--------|----------|----------|----------|----------|----------------|
| `pat_` | Pillar Analysis | `Analysis ID:` | strategic memo | `templates/memo_structure.md` | no |
| `srt_` | SEO Audit Roadmap | `Roadmap ID:` | technical-SEO roadmap | `templates/roadmap_structure.md` | yes (opt-in) |
| `krt_` | Keyword Research | `Memo ID:` | keyword strategy memo | `templates/keyword_memo_structure.md` | no |
| `qct_` | Quarter Grid cycle | `Plan ID:` | none — Teamwork tasks | `references/quarter-push.md` | yes (the push IS the task) |

The ID-label wording is a hint only — if the prefix and label ever disagree,
**trust the prefix** and let the server's `sub` binding reject a true mismatch.

`Webapp:` is where the er-seo-tools dashboard is hosted (e.g.
`https://seo.erstaging.site/`). It is **NOT** the site being audited — the
audited site comes from `siteName` in the fetched payload.

## 2. Fetch — always via the executed CLI

Run `scripts/handoff.py` in the code sandbox. **Do not rewrite its request
logic inline** — it sets a browser User-Agent (Cloudflare's WAF 403s the
default urllib UA) and an honest error taxonomy. Re-deriving it is how those
were silently dropped before.

```bash
python3 scripts/handoff.py fetch --webapp "<Webapp>" --token "<token>" --id "<id>"
```

It prints one JSON object. On success it is the API body
(`{ id, sessionId, siteName, status, audit | analysis | … }`). On failure it is
`{ "ok": false, "error_kind": "...", "status": ..., "detail": "..." }`.

### Error handling — map `error_kind` to user copy, then STOP

| `error_kind` | What to tell the user |
|--------------|------------------------|
| `cloudflare_waf` | "Cloudflare's WAF blocked the request even with a browser UA — the `/api/*` WAF rule needs adjusting for this client. (cf-ray in the detail.)" |
| `egress_blocked` | "The network sandbox is blocking the host. Run this from **Claude Code** (local network), or have an admin allowlist the domain." |
| `app_gate` | "The app's password gate rejected the route before the token was checked — it's missing from `middleware.ts`'s allowlist. App-side fix needed." |
| `token_missing` / `token_expired` / `token_invalid` / `token_*` | "The access token was rejected (`{detail}`). Click the dashboard button again to copy a fresh prompt — these tokens are short-lived." |
| `not_found` | "That record wasn't found — the id may be wrong or the row was removed." |
| `network_unreachable` | Surface the detail; suggest checking the Webapp URL / connectivity. |
| `server_error` / `rate_limited` / `bad_request` | Surface the detail; for 5xx/429 suggest a retry. |

Do not invent data or proceed past a failed fetch. **Never fabricate a document
from a failed or empty payload.**

## 3. (srt_ only) Honor the completeness verdict — note, don't re-nag

The roadmap payload's `audit.completeness` carries the webapp's verdict
(`complete | partial | thin`). The **webapp already showed the user a loud
warning** at upload/results — do **not** repeat it as an alarm. Instead:

- `complete` → nothing to add.
- `partial` / `thin` → add ONE factual line near the top of the roadmap
  (under the Executive Summary), e.g.:
  > _Scope note: this audit ran without the internal crawl, so on-page content
  > and internal-link analysis are not covered here (`{completeness.message}`)._

  Use `completeness.missingInputs` for specifics. Keep it to one or two
  sentences. Still write the roadmap from whatever real data is present; do not
  block. (`pat_`/`krt_` payloads have no `completeness` field — skip this step.)

## 4. Write the document

Read the workflow's template (table in §1) for the exact section schema and
length guidance, and follow it verbatim. Identify the audited site by
`siteName` (fall back to "the site under audit" if null) — never `Webapp:`.

### URL accuracy rule (srt_ roadmap, and any workflow that lists affected URLs)

When listing affected URLs you MUST rehydrate `affectedUrlRefs` via
`url_registry` — do **not** use the `urls`/`sampleUrls` field, which is a
display sample only.

For each `UrlRef` (integer index into `url_registry.urls`):
1. `entry = url_registry.urls[ref]`
2. if `entry.originalUrl` is set, use it as-is;
3. else reconstruct `{entry.scheme}://{url_registry.hosts[entry.hostId]}{entry.path}{?entry.query}`.

Honor `affectedUrlSource`:
- `derived-page-index` / `parser-complete` → the set is **complete**; list all and state the count confidently.
- `parser-sample` → it is a **sample**; say "sample of N shown; full count: {issue.count}" and don't imply completeness.
- `affectedUrlRefs` absent → fall back to `sampleUrls` if present, else state "(URL list unavailable — {count} affected)". Never invent URLs.

## 5. Post the document back — via the executed CLI

Pipe the finished markdown to `handoff.py post` (it routes to the right PATCH
endpoint and body field by prefix):

```bash
printf '%s' "$DOC_MARKDOWN" | python3 scripts/handoff.py post \
  --webapp "<Webapp>" --token "<token>" --id "<id>" [--structured '<json>']
```

For `srt_`, optionally pass `--structured` as a JSON array of
`{ issueType, severity, affectedCount, effort, fix }` to populate the
machine-readable column. Map any returned `error_kind` per §2.

## 6. Reply in chat — one short screen

The full document lives in the dashboard; keep the reply brief. Include the
site name, the headline numbers for the workflow, and the dashboard link:
`{Webapp}/seo-audits/results/{sessionId}` (srt_) ·
`/keyword-research/{sessionId}` (krt_) · `/pillar-analysis/{id}` (pat_).
If you added a §3 scope note, mention the audit was partial in one clause.

## 7. (srt_ only) Offer the Teamwork push — opt-in, never automatic

Only if `payload.teamwork` is present. Append a single offer line and **wait for
an explicit "yes"** before creating anything:

```
Push {N} issues to Teamwork as subtasks of "{parentTaskName}"? (Reply "yes" to proceed.)
```

The full push contract — tasklist/parent resolution, the `seo-hash:`
idempotency scan (paginate to exhaustion), subtask title/description shape, URL
rehydration, and the "no estimates / no priority / match parent assignee" rules
— is in `references/teamwork-push.md`. Follow it exactly. Execute via the
`mcp__claude_ai_Teamwork__*` tools; no code runs from that reference.

## 8. (qct_ only) Quarter cycle push — the push IS the task

A `qct_` payload means the user clicked "Push to Teamwork" on the Quarter
Grid — the pasted prompt is the consent; do not ask again. There is no
document to write. Follow `references/quarter-push.md` exactly: fetch the
cycle export (§2 CLI), create one top-level Teamwork task per pushable
assignment in that client's `tasklistId` (marker-based dedupe, skip completed
and tasklist-less rows, week dates as start/due, no estimates/priority flags),
then post the receipt via the CLI:

```bash
python3 scripts/handoff.py receipt --webapp "<Webapp>" --token "<token>" --id "<planId>" \
  --counts '{"created": N, "skippedExisting": N, "skippedNoTasklist": N, "skippedCompleted": N}'
```

Reply with a one-screen summary table: per-client result (created W{n} task /
skipped + reason) and the four totals. Execute via the
`mcp__claude_ai_Teamwork__*` tools.

## Workflow notes

- **pat_ (pillar):** the fetched body is `{ …, analysis }`; write the strategic
  memo per `templates/memo_structure.md`. No Teamwork, no completeness field.
- **krt_ (keyword):** the body carries keyword research export data; write per
  `templates/keyword_memo_structure.md`. The keyword results page is not
  workflow-gated, so a memo can be produced for any session with keyword data.
- **qct_ (quarter push):** no document; §8 + `references/quarter-push.md` are
  the whole flow. `handoff.py post` intentionally errors for qct_ tokens —
  the write-back is the `receipt` subcommand.
- **Screaming Frog export guidance** for analysts is in
  `templates/screaming-frog-setup.md` — point users there when an audit is thin
  (§3) because the internal crawl was missing.
