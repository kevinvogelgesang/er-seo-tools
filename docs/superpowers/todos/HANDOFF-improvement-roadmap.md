# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-13 (**D1 COMPLETE — all 3 PRs shipped + deployed +
prod-verified in one session**: PR #162 foundations (characterization net +
`lib/handoff/` engine + 12 facades), PR #163 route-auth adoption (8 routes on
`requireHandoffToken`), PR #164 client consolidation (`useMemoPoller` +
`MemoHandoffCard` + 4 adoptions) + legacy `pillar-analysis-narrative` skill
retired. Zero wire drift — characterization suites green untouched throughout.
Same session earlier: **A6 closed as absorbed into A8**. A5 unchanged:
code-complete, `[x]` flip still gated only on Kevin's live watches (D2 flips
with it). Next build item: **D3**.)
· **Updated by:** the D1 session (A6 closure → spec → plan → PR1 → PR2 → PR3).
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. STATE: D1 (handoff engine
consolidation) is COMPLETE — 3 PRs shipped + deployed + prod-verified
2026-07-12/13 (PR #162 foundations, PR #163 route-auth, PR #164 cards +
legacy-skill retirement; tracker status log 2026-07-13 has the full entry;
spec+plan archived). A5 (SSE push layer) remains [~] CODE-COMPLETE, gated
ONLY on Kevin's live authenticated watches; when they pass, flip A5 to [x]
AND mark D2 (memo arrival via SSE — A5 PR4 is its substance) with a dated
status-log line + handoff rewrite in the same commit. A6 closed 2026-07-12
as absorbed into A8 — never build it.

KEVIN STEPS OUTSTANDING (one er_auth browser session on
https://seo.erstaging.site, Network tab on /api/events): (a) A5-PR2 — live
single-page ADA audit + site audit progress via ada-audit:<id>/
site-audit:<id>/recents frames; (b) A5-PR3 — report render / prospect scan /
content-audit ingest push-update without the old fast poll; (c) A5-PR4 — an
er-handoff-memo write-back (pat_/srt_/krt_/kst_) pushes the memo into its
card via memo:<sid>. D1 PR3 rewired the memo cards onto one hook but
preserved the A5 topology exactly (same machine/seam/cadence/topics) — the
watches remain valid as specified.

IMMEDIATE NEXT (build): D3 — shared lib/seo-fetch/ (robots/sitemap parsing
through safeFetch) (1-2 days), then D4 (client-attached robots/sitemap
checks + history, 2-3 days), then D5 (scheduled monitoring w/ change-only
alerts, needs A1 which is done). D6 (RankMath redirect generator) needs a
Kevin decision first: build or freeze as doc — "decide, don't drift". C6/C12
stay [~] for campaign-data/gated reasons, not build work. Full pipeline for
D3: brainstorm -> spec -> Codex review -> plan -> Codex review ->
subagent-driven TDD.

D1 REFERENCE (shipped architecture): lib/handoff/ = registry.ts (server-only
HANDOFF_TOKEN_CONFIGS: per-family prefix/audience/secretEnv/devFallback/
scopes-as-const-tuples/ttl/subNoun/makeError/transport/authErrors) + meta.ts
(client-safe, HandoffFamilyKey lives here) + errors.ts (single-home error
classes) + token.ts (factory, 1:1 pillar-token clone) + prompt.ts
(composeHandoffPayload) + route-auth.ts (requireHandoffToken; VERIFIERS
table calls the FACADE verify fns so route-test vi.mocks keep working;
transport bearer-or-query = cat_ ONLY). The six lib/*-token.ts +
lib/*-prompt.ts modules and both route-auth helpers are thin facades —
exports/types byte-preserved. components/handoff/ = useMemoPoller (the
once-quadruplicated poller wiring; 14 contract tests) + MemoHandoffCard
(srt/krt wrappers); pillar MemoPoller + KeywordStrategyCard use the hook
(kst ignores the expired flag by design). Characterization suites
(lib/handoff/*-characterization.test.ts, 195 tests) are the FROZEN-WIRE
GATE — they must stay green untouched through any future change; fix code,
never those tests. Adding family #7: follow the checklist appended to the
archived spec (registry entries -> routes -> GET builder -> PATCH + one-line
emit -> card wrapper/hook -> middleware matchers + tests -> characterization
additions -> er-handoff-memo skill routing = RELEASE PREREQUISITE).

PINNED WARTS (frozen, never "fix"): token_expired is dead code fleet-wide —
jose's expiry message lacks the substring 'expired', so expired tokens map
to token_invalid (locked by test); token_service_unavailable/500 unreachable
via real HTTP in 5 of 6 families; cat_ collapses everything to auth_required.

RECORDED FOLLOW-UPS (non-blocking): (1) report-render.ts also emits
report-list — one-line cleanup if Kevin prefers. (2) kst latestSessionRef is
a vestigial write-only cache — future cleanup. (3) jose-version-coupled
substring assertions in token tests — check on any jose upgrade. (4)
memo:<sessionId> shared across 3 memo families = cross-TAB extra idempotent
refetch only, plan-level design.

CODEX MODEL: budget-gated — gpt-5.6-sol when 5h window >25% remaining, else
gpt-5.6-terra; both high effort. Encoded in the consulting-codex skill.

GOTCHAS FOR THE NEXT SESSION:
- Local gates are the ONLY type-check gate: npx tsc --noEmit + npm test +
  npm run build before EVERY merge. npm run smoke mandatory if the PR
  touches auth/SF-upload/ADA-pipeline or a component on a smoke-walked page
  (export CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/
  Google Chrome" first on macOS).
- Array-form $transaction ONLY. publishInvalidation fires AFTER the awaited
  write resolves, OUTSIDE the tx, keyed off the RETURNED ROW's FK.
- Topics are LITERAL strings (lib/events/topics.ts). Emit/subscribe identity
  test-pinned with not.toHaveBeenCalledWith(<wrongId>).
- Component tests: // @vitest-environment jsdom + afterEach(cleanup), no
  jest-dom. vi.mock('@/lib/events/client') BEFORE importing module-level
  stores.
- Tests self-provision per-worker SQLite DBs, run PARALLEL. Absolute file:
  URLs for tooling DBs.
- DateTime columns are INTEGER ms — raw SQL binds ${x.getTime()}.
- Never git add -A/-u at repo root (pentest-results/ etc untracked) — stage
  explicit paths. No backticks in Bash -m commit messages.
- .superpowers/sdd/task-N-*.md files are REUSED across PR series — a stale
  same-numbered brief/report may exist; overwrite, don't trust.
- UI-class changes: dark: variants on every element + the ThemeToggle
  mounted-guard hydration pattern.
- D3 will touch lib/security/safe-url.ts adjacency — security-sensitive
  class: middleware.test.ts coverage for any route-gating change; never
  weaken safeFetch/SSRF guards; audit-ci stays green.

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_
clipboard flow.

FIRST STEP — confirm main clean + prod healthy. Load skill
er-seo-tools-change-control FIRST. Gate policy rules 1 & 4: merge gate-green
PRs (re-run gates in-session) + deploy with post-deploy verify autonomously;
destructive server ops Kevin-gated; brainstorm->spec->plan ungated. Docs
ritual in the same commit as any ship. Then: if Kevin reports the live
watches passed, do the A5 [x] + D2 flip ritual; otherwise start D3 with
superpowers:brainstorming.
```

---

## Current state (2026-07-13, D1 complete)

- **Main** @ `4789fad` (D1 PR3 merge) + this docs commit. Prod deployed on
  PR3, healthy (6-family auth matrix verified live; `memo:` literal in
  minified chunks; server `skills/` = er-handoff-memo only).
- **D1 `[x]`** — see the tracker's 2026-07-12/13 status-log entries for the
  per-PR record (gates, reviews, prod evidence).
- **A5 `[~]` code-complete** — Kevin's live watches are the only gate; D2
  flips with it. D1 PR3 preserved the A5 topology exactly.
- **A6 `[x]`** closed as absorbed into A8 (2026-07-12).
- SDD ledger: `.superpowers/sdd/progress.md` (gitignored recovery map —
  D1 PR1/PR2/PR3 sections, per-task commits + review outcomes).
- **Kevin manual checks:** `todos/2026-07-11-kevin-manual-checks-tracker.md`.

## The single next item

**D3 — shared `lib/seo-fetch/` (robots/sitemap parsing through `safeFetch`)
(1–2 days).** Consolidates the robots.txt/sitemap parsing duplicated between
the robots-validator tool and the ADA sitemap-crawler behind one
safeFetch-routed module; unlocks D4 (client-attached checks + history) and
D5 (scheduled monitoring, A1 already done). Security-sensitive adjacency
(safeFetch/SSRF) — never weaken `lib/security/safe-url.ts`.

**D6 needs a Kevin decision** (build the RankMath redirect generator or
freeze it as a doc) before any session picks it up — "decide, don't drift".

## Loose ends (small, non-blocking)

- `docs/superpowers/specs/2026-07-06-broken-link-verify-internal-time-budget-design.md`
  + its plan still sit in the ACTIVE folders — if that work shipped (likely,
  given the builder's time budgets), archive them; verify against git log.
- C12 D1 follow-ups (retention canary, findings-rebuild wipe edge) — see the
  C12 tracker entry.
