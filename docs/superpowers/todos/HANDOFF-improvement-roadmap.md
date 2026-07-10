# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-10 (C19 PR2 — SEO recalibration — SHIPPED: PR #143 merged + deployed + prod SF-replay evidence + live v2 evidence. PR1 #142 and C13 #141 shipped earlier in the same session arc. PR3 remains.) · **Updated by:** the C13+C19 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. CURRENT ITEM: C19 — ADA+SEO scoring overhaul,
IN PROGRESS: PR1 (ADA v4, #142) and PR2 (SEO recalibration, #143) are SHIPPED + deployed +
evidence-verified. NEXT BUILD: PR3 — levers + Score Lab (the final C19 increment).

READ FIRST: docs/superpowers/specs/2026-07-09-c19-scoring-overhaul-design.md (Codex ×7; Part 4
= PR3's scope) and the tracker's top two status-log entries (2026-07-10 PR2 then PR1 — full
evidence + follow-up lists).

PR3 SCOPE (write its plan first via superpowers:writing-plans + Codex review, per-task TDD build
via superpowers:subagent-driven-development):
  • Schema (feature-class migration): new AdaScoringWeights singleton row (5 caps + advisoryDiscount;
    validation sum(caps)≤100, advisoryDiscount 0..1, ≥1 cap >0) + ScoringWeights.brokenLinks column
    (default 10). Hand-author migration SQL (migrate dev is interactive-only here); apply with
    DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … generate.
  • resolveAdaScoringWeights() (mirror C8 resolve-weights pattern); thread resolved weights into
    ada-write→mapAdaChildren/mapAdaSingle (params exist, default DEFAULT_ADA_V4_WEIGHTS);
    resolve-weights.ts drops its brokenLinks code-default for the real column; validateWeights
    PERSISTABLE_WEIGHT_KEYS grows brokenLinks; ScoringWeightsCard un-hides it (the card currently
    filters to persistable keys — one-line revert of that filter once persistable).
  • /settings ADA weights card (same UX/validation as the SEO card).
  • Score Lab (internal page, cookie-gated): pick a recent completed CrawlRun → server loads a
    scoring-inputs snapshot (GET /api/scoring/lab-inputs?runId= — ADA any-run via
    lib/scoring/ada-v4-inputs.server.ts (exists, tested); SEO post-C19 runs via the v2 breakdown's
    inputsSnapshot; pre-C19 SEO → "what-if unavailable") → sliders recompute score+breakdown live
    in-browser via the pure scorers (computeAdaScoreV4 / seo-core fns — all client-safe);
    "Save as global defaults" persists via the settings endpoints; banner: historical scores keep
    stamped weights. Weights saves change weightsHash → comparabilityBreak 'weights' suppresses
    sparkline deltas (PR2 wired this end-to-end — it just works).
  • Fold in the PR1+PR2 follow-up minors (see tracker entries): ada-v4-inputs violation orderBy;
    parity score-diff noise on pre-C19 audits (document or version-gate); malformed-wcagTags test;
    replay catch-label granularity; report-html sparkline dash marker hash-awareness; hashWeights
    cast wart (shared typed wrapper); broken-image-branch test.

PR3 RECON (verified 2026-07-10, fresh — trust over memory):
  • app/api/settings/scoring-weights/route.ts: GET + PUT (no withRoute — own JSON-parse guard);
    PUT: validateWeights → explicit PERSISTABLE_WEIGHT_KEYS pick → upsert({where:{id:1}}) →
    responds {weights: v} (the full 9-key validated object). PR3: add brokenLinks to
    PERSISTABLE_WEIGHT_KEYS + drop validateWeights' forced brokenLinks default + new ADA route
    (mirror this file; consider withRoute for the NEW route per house A3 rule).
  • components/settings/ScoringWeightsCard.tsx: 'use client', useState + fetch-on-mount GET,
    save() PUTs the whole weights object, keys = PERSISTABLE_WEIGHT_KEYS (the PR2 filter hiding
    brokenLinks — REMOVE the filter comment/line once persistable). Mirror its exact classNames
    for the ADA card (card: "mt-6 bg-white dark:bg-navy-card border border-gray-200
    dark:border-navy-border rounded-2xl shadow-sm p-6"; input: "mt-1 w-full rounded-lg border
    border-gray-300 dark:border-navy-border bg-white dark:bg-navy-deep px-3 py-2 text-navy
    dark:text-white"; save btn: "rounded-lg bg-navy text-white dark:bg-white dark:text-navy
    px-4 py-2 text-[13px] font-heading font-semibold").
  • app/(app)/settings/page.tsx: server component; cards in order ServiceAccountCard →
    ScheduleControls → ScoringWeightsCard; ADA card slots 4th; Score Lab link slots next to the
    existing <a href="/admin/ops"> line (text-blue-600 dark:text-blue-400 hover:underline).
  • Migration pattern to copy: prisma/migrations/20260703120000_configurable_scoring_weights/
    migration.sql (CREATE TABLE with INTEGER PK DEFAULT 1, REAL NOT NULL DEFAULT per weight,
    "updatedAt" DATETIME NOT NULL with NO default — Prisma @updatedAt fills it). PR3 migration =
    new AdaScoringWeights table (critical 40/serious 30/moderate 15/minor 5/needsReview 10 REAL
    + advisoryDiscount REAL DEFAULT 0.4) + ALTER TABLE "ScoringWeights" ADD COLUMN "brokenLinks"
    REAL NOT NULL DEFAULT 10.
  • ⚠ KEY GAP (recon item 5): NO ADA weight resolution exists in the write path — lib/findings/
    ada-write.ts calls mapAdaChildren(parent, children) / mapAdaSingle(audit) WITHOUT the weights
    param (both default to DEFAULT_ADA_V4_WEIGHTS). PR3 must create resolveAdaScoringWeights()
    (mirror resolve-weights.ts) and thread it through BOTH ada-write call sites (they're async —
    await the resolve before mapping). ada-v4-inputs.server.ts exists tested:
    loadAdaV4InputsForRun(runId) → AdaV4Inputs | null (null only when zero scored pages).
  • resolve-weights.ts line ~12 has the exact `brokenLinks: DEFAULT_WEIGHTS.brokenLinks // PR3`
    line to replace with `row.brokenLinks`.
  • Nav precedent for the Lab: tools-registry TOOLS entry with hidden: true (exactly how /admin
    is handled — addressable, not in sidebar) + the manual settings-page link. Lab page path
    suggestion: /score-lab under app/(app)/ (cookie-gated by default, NO middleware change).
  • "Pick a run" for the Lab: no dedicated endpoint exists; recents machinery is overkill —
    add a small query in the lab-inputs route file's sibling loader or a `?list=1` mode:
    prisma.crawlRun.findMany({ where: { status: 'complete' }, orderBy: { createdAt: 'desc' },
    take: 25, select: { id, domain, tool, source, score, createdAt } }).
  • Lab SEO inputs: post-C19 runs carry breakdown.inputsSnapshot (source 'sf'|'live'); pre-C19
    SEO runs → "what-if unavailable". ADA: any run via loadAdaV4InputsForRun. Client recompute:
    computeAdaScoreV4 + the seo-core curve fns are all client-safe; rebuild the SEO factor sum
    client-side mirroring the adapters' availability rules (factors present in the stored
    breakdown tell you which were available — recompute earned per factor from inputsSnapshot).
  • validateAdaWeights (new, client-safe in lib/scoring/): each cap 0..100, sum(caps) ≤ 100,
    advisoryDiscount 0..1, at least one cap > 0 (spec Part 4 / Codex spec-fix #2).
  • Keep archetype suites green: changing DEFAULTS is NOT in PR3 scope (defaults stay
    40/30/15/5/10/0.4 and SEO knees stay) — the Lab/levers change RUNTIME weights, not defaults.

CONTEXT YOU NEED:
  • Kevin's rulings (recorded): v4 calibration ACCEPTED (Bellus-class = D-grade 68; node-volume
    dial stays FUTURE); school-grade anchor; internal-first explanations.
  • ADA v4 lives in lib/scoring/ada-v4.ts (DEFAULT_ADA_V4_WEIGHTS caps 40/30/15/5/10 +
    advisoryDiscount 0.4 = PR3's lever set); SEO curves in lib/scoring/seo-core.ts (SEO_KNEES).
  • Archetype calibration suites (ada-v4-calibration.test.ts + seo-calibration.test.ts) are the
    band contract — never widen a band; weight-default changes must keep them green.
  • lib/scoring/ stays pure+client-safe EXCEPT *.server.ts + weights-hash.ts (server-only).
  • New API route → cookie-gated by default (no middleware change needed for lab-inputs).
  • SDD ledger: .superpowers/sdd/progress.md (PR1+PR2 sections complete — do not re-dispatch).

⚠ DEPLOY RECIPE: git push && ssh seo@144.126.213.242 "pm2 stop seo-tools && ~/deploy.sh"
then verify .next/BUILD_ID + health + boot log + schedules. PR3 HAS A MIGRATION — it applies
automatically in deploy.sh (prisma migrate deploy); no new required env vars expected.

Kevin eyeballs outstanding (authed-UI): C15 Mine-filter · C16 Audits page · C17 seoOnly auto-flip ·
C18 results tabs · C14 /sales + real /sales/[token] report · re-scan Bellus (v4 badge + deduction
invoice; expect ≈68, Kevin-accepted) · /settings SEO card (brokenLinks hidden until PR3).

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/qct_ clipboard flow.

FIRST STEP — confirm main clean + prod healthy (git log origin/main; ssh seo@144.126.213.242
"curl -s localhost:3000/api/health").

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4): standing authorization
to merge gate-green roadmap PRs (re-run gates in-session) + deploy with post-deploy verify;
destructive server ops Kevin-gated; spec→plan ungated (Codex each artifact, notify Kevin one
line + path, don't wait). Docs ritual in the same commit as any ship. Trust ranking: code >
plan/spec > tracker/handoff.

ENV NOTE: gates = npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm run build.
Dev e2e: DATABASE_URL="file:./local-dev.db" NEXT_PUBLIC_APP_URL="http://localhost:3000"
APP_AUTH_PASSWORD="" npm run dev + CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/
MacOS/Google Chrome"; a seoOnly site audit of https://example.com exercises the full live-scan
path (expect v2 breakdown + linkVerification). Never git add -A. Test gotchas: act() not waitFor
under fake timers; getAllBy* for repeated copy; route files export only handlers+config; SQLite
migrations: no ALTER COLUMN nullability (PRAGMA rebuild pattern). Prod replay (read-only):
ssh seo@144.126.213.242 "cd /home/seo/webapps/seo-tools && DATABASE_URL='file:/home/seo/data/
seo-tools/db.sqlite?mode=ro' npx tsx scripts/score-replay.ts"
```

---

## Current state (2026-07-10, post-C19-PR2)

- **Shipped + deployed:** C13 (#141), C19 PR1 (#142), C19 PR2 (#143). Prod healthy.
- **Evidence on file (tracker):** ADA replay (165 runs, redistribution Kevin-accepted); SEO SF
  replay (15 baselines, Δ 0..−11 median −7, gentle tightening, no stop condition); live v2
  breakdown with linkVerification verified dev end-to-end + real-handler DB tests.
- **Next:** C19 PR3 (above). After C19: A8 visual-polish arc · C12 content auditing (zero-AI
  Tier-0) · SF-retirement parity cycles 2–3 · Track A infra (A5/A7) · Track D.

## Gotchas carried forward

- `pentest-results/`, `googlefc472dc61896519a.html`, `SEO_Report_1st_Draft.pdf` untracked at repo
  root — NEVER `git add -A`. Deleted `.playwright-mcp/*` working-tree deletions are harmless.
- Every new public/token route: middleware `isPublicPath` + `middleware.test.ts` case (the Score
  Lab page + lab-inputs route are cookie-gated — NO middleware change, do not add one).
- Share/redirect URLs: `NEXT_PUBLIC_APP_URL`, never request origin.
- Array-form `$transaction([...])` only; raw SQL sets `updatedAt` manually.
- Codex consults: session UUID in `~/.claude/state/codex-consultations.json`; budget-check first;
  run `codex exec` in background (10-min foreground timeout).
- A stale `running` example.com SiteAudit can linger in local-dev.db from DB-backed test runs —
  recovery drains it on next dev boot; harmless.
