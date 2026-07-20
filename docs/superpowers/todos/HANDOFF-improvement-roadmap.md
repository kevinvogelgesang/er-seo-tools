# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-20 (**SF-RETIREMENT PHASE 2 — hybrid-crawler under-expansion
fix: L1 SHIPPED + DEPLOYED + PROD-VERIFIED (PR #235).** Prod diagnosis overturned the
"tune the BFS" framing: the blocked clients are **JS-blind** (raw-HTTP discovery can't
see client-rendered nav) + a few bound-capped + metric noise. Fix is 3 phased
increments — **L1 (policy-filtered coverage metric) is done**; **NEXT = L2 (rendered-DOM
adaptive discovery — the JS-blind fix, the long pole)**, then L3 (bound adaptivity).)
· **Updated by:** the hybrid-discovery-L1 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. STATE (2026-07-20): the SF-RETIREMENT
CAMPAIGN's Phase-2 HYBRID-CRAWLER UNDER-EXPANSION FIX is underway. Kevin set the
Phase-7 retirement bar (N=8 qualifying weekly seoIntent sweeps / discovery
residualMiss ≤ 5% STRICT / fleet-wide / split crawler-vs-keyword-joiner gate). The
single buildable code item the bar gates on is the hybrid-crawler under-expansion fix.

DIAGNOSIS (empirical, 29-domain prod probe 2026-07-20 — this overturned the earlier
"frontier/depth tuning" framing). The blocked clients split into THREE root causes:
  1. JS-BLIND CRAWLER (the dominant one): the raw-HTTP hybrid crawler cannot see
     client-rendered navigation. cambria/glow/nuvani/brownson/federico homepages
     return 60-120KB HTML but ZERO same-host <a href> in raw markup (verified with
     the crawler's own fetch+regex). The AXE audit sees those links only because it
     renders with headless Chrome (HarvestedLink). BFS tuning CANNOT help these.
  2. BOUND HITS: discovery (maxFetches@400, 623+ pages), soma (maxFetches@400),
     healthcarecareer (maxAdded@300), beal (timeBudget@120s — time-bound, NOT
     cap-bound).
  3. METRIC NOISE: much of "residual" was tracking-param dupes, %C2%A0 malformed
     URLs, pagination, WP taxonomy, thank-you, account URLs — not content.

Kevin's decisions (locked): scope = ALL THREE levers L1+L2+L3, phased; L1
aggressiveness = FULLER (params + malformed + non-content patterns), documented.

DONE THIS SESSION — L1 (policy-filtered coverage metric): SHIPPED PR #235, merged,
deployed, prod-verified. discoveryCoverageJson.residualMissRate is now content-only
(the gate); residualMissRateRaw retains the old number; two-sided attribution
(excludedByReason numerator + baselineExcludedByReason denominator +
nonContentExcludedCount/baselineExcludedCount) reconciles the delta. Pure
coverage-local change (contentNormalize/classifyExclusion layered on the UNTOUCHED
shared normalizeCoverageUrl — crawl KEY + frozen char test unaffected). Gates green
(tsc / 6747 tests / build); frozen broken-link-verify.characterization.test.ts
re-pinned ADDITIVELY (old fields byte-identical = isolation proof). Spec + plan both
Codex P0-reviewed (6 + 8 fixes applied). AUTHORITATIVE fleet re-baseline lands from
the Mon 2026-07-27 sweep (coverage recomputed there) — RECORD the filtered per-domain
numbers in the parity log then.

YOUR JOB THIS SESSION: build L2 — rendered-DOM adaptive discovery (the JS-blind fix).
The SPEC is ALREADY WRITTEN + Codex-reviewed for all 3 increments:
docs/superpowers/specs/2026-07-20-hybrid-discovery-under-expansion-design.md (§L2).
So: invoke er-seo-tools-sf-retirement-campaign (Phase 2), then superpowers:writing-plans
for L2 → route the L2 plan to Codex (P0) → apply fixes → TDD build → gates → PR →
merge → deploy → PROD MEMORY-VERIFY → tracker+handoff ritual. Then L3 (bounds) after.

L2 DESIGN ESSENTIALS (from the Codex-reviewed spec — do not re-derive, but the PLAN
is yours to write):
  - New lib/ada-audit/seo/rendered-crawl.ts: fetchPageLinksViaBrowser(url, host) →
    renders via acquirePage(), reads document.querySelectorAll('a[href]'), returns
    the same FetchedPage shape so it plugs into hybridCrawl's injected fetchPageLinks.
  - EXTRACT the SSRF request-interceptor from sitemap-crawler-browser-fetch.ts into
    ONE shared helper (don't re-copy); it MUST abort an off-domain main-frame redirect
    BEFORE render (not reject finalUrl after) and BLOCK image/media/font/stylesheet
    subresources; cap anchors per page.
  - ADAPTIVE JS-blindness probe: render homepage + 1-2 shallow hubs / /site-map*
    candidates; trigger the rendered pass on count of NORMALIZED ADMISSIBLE rendered
    URLs NOVEL vs the raw crawl (NOT rendered-minus-raw); record probe FAILURE
    (WAF/consent) distinctly from no-delta.
  - CORRECTED seed model (Codex F2): hybridCrawl gets THREE inputs — knownUrls
    (dedup only, NEVER fetched) / true publisher seeds (homepage) / rendered
    candidates (through the normal same-domain+robots+depth+query+non-page filters).
    Do NOT pass the existing discovered set as seeds (seeds bypass robots + become
    depth-0 frontier → 40 renders wasted re-fetching known URLs). Prioritize novel hubs.
  - ABSOLUTE discovery deadline (Codex F1 — the zombie-handler guard): ONE deadline
    across seed-resolve + raw crawl + probe + rendered crawl + INSERT_RESERVE; nav/
    settle clamped to remaining; no new wave after it; wrap acquirePage so a waiter
    blocked past the deadline is cancelled WITHOUT leaking a pool slot.
  - Merge raw ∪ rendered by normalizeCoverageUrl with precedence (sitemap>seed>
    shallow>rendered>linked), NOT a string Set; define HARD_CAP-full behavior.
  - Bounds (env): HYBRID_RENDER_MAX_DEPTH 2, MAX_FETCHES 40, MAX_ADDED 300,
    CONCURRENCY 2 (≤ pool 4), TIME_BUDGET_MS 90000 (deadline-clamped),
    PROBE_MIN_NOVEL 5, MAX_ANCHORS_PER_PAGE ~1500.

HARD CONSTRAINTS (the scars — L2 is the memory-sensitive one): BROWSER_POOL_SIZE
stays ≤4 (each Chrome page ~150-200MB); the 2026-06-22 build-OOM + the 2026-07-16
verifier crash-loop are why. Discovery runs BEFORE this audit's page jobs fan out,
so the pool is free of THIS audit; worst case = render-discovery(2) + a concurrent
standalone ADA audit(2) = full pool, never over. Never weaken safeFetch/SSRF;
lib/seo-fetch is FROZEN. Array-form $transaction only. PROD MEMORY VERIFY (Codex
F1): run render-discovery WHILE 2 standalone ADA audits run; record total
PROCESS-TREE RSS (parent + all Chromium descendants — pm2 status misses descendant
RSS + short peaks), system headroom, PM2 restarts, against a numeric threshold.

FAIL-CLOSED (Codex F6): some clients cannot reach ≤5% by any lever (>1000 pages;
routes only via form POST / JS click / infinite scroll / router state with no
rendered href; isolated link clusters absent from the coverage denominator). Those
stay on SF/manual discovery — an honest campaign outcome; their N=8 clock never
starts. Surface as a labeled fallback state, never a silent sub-5% pass.

WORKTREE: .claude/worktrees/hybrid-discovery-expansion already exists (node_modules
symlinked, .env copied). Branch feat/hybrid-discovery-expansion held L1 and is MERGED
— for L2, `git fetch && git checkout -b feat/hybrid-discovery-L2 origin/main` in that
worktree (or reuse it). The falsifiable number stays discoveryCoverageJson
.residualMissRate (now policy-filtered) per client, re-measured by the scratch prod
probe after deploy.

FIRST STEPS: (1) multi-agent pre-flight (er-seo-tools-multi-agent-coordination) —
other Claude/Codex sessions + vb-* lanes may share the checkout; you already have a
worktree. (2) Confirm prod healthy (source .claude/ops-secrets.local.sh from the MAIN
checkout — it's gitignored, absent in the worktree; ssh $PROD_SSH pm2 status). (3)
Invoke er-seo-tools-sf-retirement-campaign, then writing-plans for L2.

TWO OPEN BEHAVIORAL PROD-VERIFICATIONS (non-blocking; need a UI-triggered authed
session — no autonomous prod session has Kevin's cookie): (a) MANUAL SWEEP — "Queue
all clients" → WeeklySweep(origin='manual') + /issues manual snapshot (origin label,
suppressed streak, "vs last Sunday"), no email, one-in-flight 409, ≤10min drain. (b)
SWEEP ERROR TRIAGE (PR #227) — a 404-bearing client → dead_page finding +
DeadPagesSection, no /cdn-cgi/, null statusCode, 'pages-errored' reason. The Mon
2026-07-27 sweep auto-exercises both.

KEVIN QUESTIONS OUTSTANDING (non-blocking): (a) proway.erstaging.site (staging) in
the weekly-sweep cohort — intentional? (b) sales MethodExplainer beside the
SEO-unavailable note (copy call). (c) D3 optional page-count glance on the next real audit.

PROD ACCESS: source .claude/ops-secrets.local.sh (gitignored; in the MAIN checkout,
NOT the worktree). Live DB file:/home/seo/data/seo-tools/db.sqlite. NO sqlite3 CLI —
prod DB probes via node + the app's PrismaClient (write script to a temp file + scp;
tsx importing app source hits the 'server-only' guard for anything pulling
lib/seo-fetch/fetch.ts — replicate raw logic inline for those probes). Gate policy:
read-only inspection + gate-green deploy + pm2 restart AUTONOMOUS; destructive ops
Kevin-gated per conversation.

CODEX MODEL: budget-gated — gpt-5.6-sol when 5h used <75%, else gpt-5.6-terra; both
high. Spec/plan/decision-doc review = P0 (always route). Codex foreground times out
at ~2min — run it as a BACKGROUND Bash job (memory: codex-background-lanes). Codex
CANNOT commit (worktree .git outside its sandbox) — Claude commits after review.

GOTCHAS: local gates are the ONLY type-check gate (npm run lint = tsc; npm test =
vitest; npm run build = next build with the heap cap — never bare npx next build).
Env ints via parsePositiveInt(process.env.X, fallback) from @/lib/jobs/config.
logError takes a RECORD context: logError({subsystem,scope}, err). New cookie-gated
routes need NO middleware change; public needs anchored matchers + middleware.test.ts.
Tests self-provision per-worker SQLite DBs, run PARALLEL; save/restore any env a suite
sets. Never git add -A/-u at repo root. No backticks in Bash -m commit messages.
broken-link-verify.characterization.test.ts is FROZEN byte-identical (re-pin
deliberately + additively if a coverage field is added).

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_ clipboard flow.
```

---

## Current state (one paragraph)

Roadmap spine complete: A1-A8, B-series, C-series through **C21 (weekly client sweep)**,
D0-D8 all [x]. The **SF-retirement campaign** is in **Phase 2 (hybrid discovery)**:
Kevin set the Phase-7 retirement bar 2026-07-20 (N=8 / residualMiss ≤ 5% strict /
fleet-wide / split gate), and this session picked up the single buildable code item it
gates on — the **hybrid-crawler under-expansion fix**. A 29-domain prod probe overturned
the "tune the BFS" framing: the blocked clients are mostly **JS-blind** (raw-HTTP
discovery can't see client-rendered nav — verified on cambria/glow/nuvani), plus a few
bound-capped, plus metric noise. The fix is 3 phased increments (one Codex-reviewed spec
covers all three). **L1 (policy-filtered coverage metric) SHIPPED + DEPLOYED +
PROD-VERIFIED (PR #235)** this session — `residualMissRate` now counts content pages
only, with a raw companion + two-sided per-reason attribution; pure coverage-local
change, shared normalizer untouched, frozen char test re-pinned additively; gates green;
Codex P0-reviewed spec + plan. **NEXT = L2 (rendered-DOM adaptive discovery — the
JS-blind fix, the long pole, memory-sensitive)**, then **L3 (bound adaptivity)**; the
spec's L2/L3 sections are written and Codex-reviewed, so the next session writes the L2
*plan* (Codex P0) → TDD → deploy → prod memory-verify. Work lives in worktree
`.claude/worktrees/hybrid-discovery-expansion`. The authoritative L1 fleet re-baseline
lands from the Mon 2026-07-27 sweep. See `2026-07-05-sf-live-parity-log.md` →
`🔧 2026-07-20 — Hybrid-discovery under-expansion fix`.
