# AI Memo Tools (Pillar Analysis · Keyword Research · Handoff System) — Improvement Roadmap

**Date:** 2026-06-10 · **Status:** NYI strategy doc
**Scope:** `app/pillar-analysis/**`, `app/keyword-research/**`, `lib/services/pillarAnalysis/**` (~3.2k LOC incl. local embeddings), the three token modules (`pillar-token.ts`, `seo-roadmap-token.ts`, `keyword-memo-token.ts`), `memo-poller-machine.ts`, `skills/er-handoff-memo/**`

---

## Current state (verified)

- **Workflow:** dashboard button mints a scoped JWT (`pat_`/`srt_`/`krt_`,
  1-hour expiry) → clipboard payload → analyst pastes into Claude Code → the
  `er-handoff-memo` skill fetches the structured export, writes the memo,
  PATCHes it back → the dashboard polls every 3 s (15-min lifetime,
  visibility-aware state machine) until `*UpdatedAt` changes.
- **Three parallel token modules** that are ~90% identical (same JWT shape,
  same issuer, different prefix/env-var/scope strings; 301 LOC where ~120
  would do), and ~40% duplicated verify/scope code across their six API routes.
- **Two parallel poller implementations**: `MemoPoller.tsx` (pillar) and
  `KeywordMemoCard.tsx` (keyword) embed the same machine wiring separately.
- **Pillar analysis is deterministic and local** — MiniLM embeddings via
  @xenova/transformers cluster keywords; scoring/verdicts are code, not AI.
  Only the *narrative* layer is Claude-written via the handoff.
- **Keyword research has no data source of its own** — it's a re-slice of
  SEMRush CSVs uploaded through the parser (gap keywords capped at 500).
- A legacy `skills/pillar-analysis-narrative/` coexists with the unified
  `er-handoff-memo` skill.

## The big-picture problem

The clipboard handoff is a clever zero-billing bridge, but it makes the
analyst a human message bus: mint → paste → wait → poll. Each new memo type
(there are already three) clones a token module, two routes, a prompt
composer, and a poller. The pattern works; the *implementation* treats each
instance as a one-off, and the *transport* has a hard dependency on someone
having Claude Code open.

## Recommendation

### Phase 1 — One handoff engine instead of three copies (1 wk)

- **Token factory:** a single `lib/handoff/token.ts` parameterized by
  `{prefix, audience, scopes, envVar}`; the three modules become three config
  entries. The skill's `handoff.py` ROUTES table is already the unified
  pattern — mirror it server-side as one `HANDOFF_TYPES` registry that drives
  mint, verify, GET/PATCH handling, and the clipboard prompt composer. (App
  Router still requires the filesystem route files; they become 3-line
  delegations into the shared handlers rather than six independent
  implementations.)
- **One `<MemoHandoffCard>`** component (button + poller + markdown render)
  used by pillar, roadmap, and keyword pages.
- Delete the legacy `pillar-analysis-narrative` skill once verified unused.
- Net effect: a fourth memo type (they keep appearing) becomes a config entry
  + template, not a week of plumbing.

### Phase 2 — Replace polling with push (0.5–1 wk)

The memo PATCH endpoint *knows* the moment the memo arrives. Emit a
server-sent event (single VPS, long-lived Node process — SSE is trivial here)
and let the dashboard subscribe instead of running a 15-minute polling state
machine. The `memo-poller-machine` (138 LOC of visibility-rebasing
subtlety) becomes a thin reconnect handler. Keep one poll-on-focus fallback.
This also generalizes: the same SSE channel serves audit progress
(`02-ada-audit.md`) and kills most bespoke pollers in the app.

### Phase 3 — Decide the transport's future: direct API generation (1–2 wks, **gated — not on the default roadmap**)

This phase is a product/billing decision first and an engineering task
second. It does not count toward the critical-path spine in `00-overview.md`
unless the gate opens.

CLAUDE.md currently forbids Anthropic-API features pending billing. The
honest big-picture statement:

- **End state worth wanting:** "Generate memo" calls the Anthropic API
  server-side (the prompt material — structured export + templates — already
  exists in the skill), streams the draft into the dashboard, and the analyst
  edits/approves there. The handoff flow remains as the no-API fallback.
  Cost reality at this scale: tens of memos a month ≈ single-digit dollars.
- **Decision to make first:** turn on API billing (then build this), or
  explicitly commit to the clipboard handoff as the permanent transport (then
  invest Phase 1/2 polish without guilt). The worst path is the current
  implicit one — maintaining handoff plumbing while treating it as temporary.
- If built: an `MemoJob` on the platform job queue, streaming tokens over the
  Phase 2 SSE channel, memo versions stored relationally (draft → approved),
  prompt templates versioned in-repo.

### Phase 4 — Keyword research grows its own data source (1–2 wks, ties to SF-retirement Phase 6)

Keyword research today is bounded by what an analyst exports from SEMRush
into the parser. The SF-retirement roadmap's Phase 6 (direct GSC / GA4 /
DataForSEO-or-SEMRush API ingestion) lands here: client-keyed keyword and
performance data flowing in on the job queue, memo exports reading from
tables instead of `Session.result` blobs, and gap analysis that refreshes
itself instead of going stale the day after upload.

## What I would not do

- Don't unify the three token *secrets* into one env var — separate scopes
  per memo type are a real security property; unify the code, not the keys.
- Don't build a queue/scheduler for memos before Phase 3 is decided — memos
  are human-paced today.
- Don't move pillar-analysis clustering to an LLM; the local-embedding
  pipeline is fast, free, deterministic, and good. AI belongs only at the
  narrative layer.

## Effort summary

| Phase | Effort | Depends on |
|---|---|---|
| 1. Handoff engine consolidation | 1 wk | — |
| 2. SSE push | 0.5–1 wk | — (shared with platform) |
| 3. Direct API generation | 1–2 wks | **Billing decision — off-roadmap until opened** |
| 4. Keyword data ingestion | 1–2 wks | Platform job queue |

Total ≈ 3.5–6 weeks depending on the two gated decisions (billing; API
ingestion scope).
