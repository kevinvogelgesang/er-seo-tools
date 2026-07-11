# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-10 (C20 **KS-2 SHIPPED + DEPLOYED + PROD-VERIFIED (dark)** — PR
#147, `d9c6434`; KS-1 shipped earlier same day, PR #146. Next: KS-3 spec.) ·
**Updated by:** the KS-1/KS-2 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. LAST COMPLETED: C20/KS-2 (DataForSEO
volume provider + durable cache) SHIPPED DARK — PR #147 merged (d9c6434), deployed +
prod-verified 2026-07-10 (migration 20260710200000_keyword_volume_cache applied,
KeywordVolumeCache live, zero volume-module output in prod boot = dark posture proven,
4269 tests / 480 files green). NOTHING consumes getKeywordVolumes until KS-5; enabling
= Kevin .env edit (DATAFORSEO_LOGIN/PASSWORD) + restart, NOT a deploy prerequisite.
Same day: KS-1 (GSC query×page snapshot) shipped, PR #146. C20 is [~] — 2 of 5 MVP
increments done. Both spec/plan pairs archived.

NEXT ITEM: KS-3 SPEC — client institution profile + STRUCTURED program roster +
keyword locale codes. Scope per the umbrella
(docs/superpowers/specs/2026-07-10-keyword-strategy-capability-design.md §4 KS-3 +
Codex #3/#7): Client gains institutionType (trade/bootcamp/university/k12 + 'other'
escape hatch — §5 Q5 open), a structured programs roster — JSON array of
{name, url?, aliases?, credentialLevel?, confirmed} objects, NOT bare strings, with
auto-SUGGESTIONS retained separately from confirmed entries — and a keyword locale
profile (location/language codes for DataForSEO + market names for display; KS-2's
volume-normalize.ts normalizeLocale is the validation seam — confirm its language
regex against real DataForSEO language_code values, a rolled-up KS-2 review note).
Editable on the client manage page. "Suggest from latest scan" action derives
candidates from the newest live-scan run (pillar page-typing classifier
lib/services/pillarAnalysis/pageType.ts + JSON-LD Course/EducationalOccupationalProgram
names + title/H1 tokens) — suggestions only; the durable roster is human-confirmed.
Spec decisions: storage shape (Client JSON columns vs new model), suggestion
derivation seam, manage-page UX, locale picker source (static curated list vs
locations-endpoint sync — umbrella §10 breadcrumb). Kevin §5 Q2 (roster UX) + Q5
(profile shape) relate but don't block the spec — propose defaults, Codex reviews.

RITUAL: spec in docs/superpowers/specs/ → notify Kevin one line + path → Codex review
(consulting-codex skill; session UUID in ~/.claude/state/codex-consultations.json,
budget-check first; session at turn ~57) → apply named fixes → plan → Codex → TDD
build (subagent-driven) → gates → PR → merge → deploy → prod-verify → tracker+handoff
same commit → archive docs.

AFTER KS-3: KS-4 (FAQ tri-state present|not-detected|unknown + page inventory;
parse-seo-dom.ts is string-injected — SWC-helper-free, NO typeof) · KS-5 (krt_-v2
client-scoped export + BILLABLE volume-lookup endpoint: dedicated scope, anchored
single-route middleware regex + middleware.test.ts case, persisted per-session usage
ledger via conditional array-form update; er-handoff-memo skill upgrade). MVP =
KS-1..5. Kevin §5 decisions (spend envelope, roster UX, token family, SEMRush role,
profile shape, GSC cadence, FAQ phrasing) — ask only if he engages.

READ FIRST: the umbrella doc's KS-3 section + the tracker's top status-log entry
(2026-07-10 KS-2 shipped). Trust ranking: code > plan/spec > tracker/handoff.

Kevin eyeballs outstanding (authed-UI): GscKeywordCard on a GSC-mapped client
dashboard (hit Refresh once — KS-1) · C15 Mine-filter · C16 Audits page · C17 seoOnly
auto-flip · C18 results tabs · C14 /sales + real /sales/[token] report · re-scan
Bellus (v4 badge + invoice; expect ≈68) · post-C19: /settings SEO+ADA cards +
/score-lab · post-A8-PR7: /clients fleet + client dashboard (weightsHash suppression
on first real ScoringWeights save — observe only).

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/qct_ clipboard flow.
(DataForSEO is a DATA API — does not touch this gate.)

FIRST STEP — confirm main clean + prod healthy (git log origin/main; ssh
seo@144.126.213.242 "curl -s localhost:3000/api/health").

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4): standing
authorization to merge gate-green roadmap PRs (re-run gates in-session) + deploy with
post-deploy verify; destructive server ops Kevin-gated; spec→plan ungated (Codex each
artifact, notify Kevin one line + path, don't wait). Docs ritual in the same commit
as any ship.

ENV NOTE: gates = npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm
run build. Migrations: hand-author SQL (migrate dev is interactive-only here), apply
with DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … generate;
SQLite: no ALTER COLUMN nullability (PRAGMA rebuild). Never git add -A. Test gotchas:
vitest globals:false → afterEach(cleanup) in component tests rendering repeated text;
act() not waitFor under fake timers; getAllBy* for repeated copy; route files export
only handlers+config; Prisma client is a proxy — vi.spyOn on model methods breaks on
mockRestore (use shadow-and-restore or mock the module).
⚠ DEPLOY RECIPE: git push && ssh seo@144.126.213.242 "pm2 stop seo-tools && ~/deploy.sh"
then verify .next/BUILD_ID + health + boot log.
```

---

## Current state (2026-07-10, post-KS-2-ship)

- **Main** @ `d9c6434` (PR #147 merge) + this ritual commit. **Prod on `d9c6434`**,
  deployed + verified (fresh BUILD_ID, health ok, KeywordVolumeCache probed read-only,
  0 unstable restarts, dark posture proven — zero volume output in prod boot).
- **C20 `[~]`** — KS-1 + KS-2 SHIPPED (2 of 5 MVP increments), both same-day 2026-07-10.
  KS-2 Codex trail: spec ×5, plan ×6, 2 build fix loops (non-discriminating throttle
  test → red-verified FIFO probe; providerCost known-zero vs unknown-null), final opus
  review 0 Critical/Important.
- **What KS-2 gives KS-5:** `getKeywordVolumes(keywords, locale)` with full spend
  accounting (`providerCost` 0=known-zero / null=unresolved / sum=lower-bound;
  `attemptedChunks`/`successfulChunks` visible) — the ledger charges REQUESTS;
  cache makes re-runs ~free. Locale is an explicit arg until KS-3's profile.
- All other tracker state unchanged.

## The single next item

**KS-3 spec** — client institution profile + structured program roster + locale codes
(umbrella §4 KS-3). Key decisions: storage shape, suggestion derivation from the
pillar classifier + JSON-LD, manage-page UX, locale picker source. Confirm KS-2's
`normalizeLocale` language regex against real DataForSEO codes (rolled-up note).

## Gotchas for the next session

- `lib/keywords/volume-normalize.ts` is the ONE canonicalizer — KS-3's locale profile
  must validate through `normalizeLocale`, never a second regex.
- `getKeywordVolumes` providerCost semantics are contractual (0 ≠ null); KS-5's ledger
  must not collapse them.
- Rolled-up test debts for KS-5's fixture pass: transport top-level non-20000 status
  case; per-entry missing `search_volume` monthly case.
- `lib/keywords/gsc-snapshot.ts` + `volume-throttle.ts` both use the derived-promise
  `.catch` pattern — do not "simplify" it away (unhandled rejection = process crash;
  regression tests pin both).
- `pentest-results/`, `googlefc472dc61896519a.html`, `SEO_Report_1st_Draft.pdf`
  untracked at repo root — NEVER `git add -A`.
- Every new public/token route: middleware `isPublicPath` + `middleware.test.ts` case
  (bit prod 3×). KS-3 adds NO public routes; KS-5's volume-lookup needs exactly one
  anchored regex.
- Array-form `$transaction([...])` only; KS-5's usage ledger = conditional update /
  EXISTS predicate, never interactive.
- Prod deploy uses the interim OOM recipe (`pm2 stop seo-tools && ~/deploy.sh`).
- A stale `running` example.com SiteAudit can linger in local-dev.db from DB-backed
  test runs — recovery drains it on next dev boot; harmless.
