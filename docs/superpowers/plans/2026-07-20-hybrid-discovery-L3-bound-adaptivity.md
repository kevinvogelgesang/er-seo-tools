# Hybrid-discovery L3 — bound adaptivity for large raw-HTML sites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the raw-HTTP hybrid-crawl count caps so large raw-HTML client sites that were cut off by `maxAdded`/`maxFetches` (healthcarecareer, soma) can discover more of their reachable pages, dropping their per-run `residualMissRate` toward ≤5% — without touching memory, the L2 deadline plumbing, or the audited-page cap semantics.

**Architecture:** L3 is the third and smallest increment of the hybrid-discovery under-expansion fix (spec `docs/superpowers/specs/2026-07-20-hybrid-discovery-under-expansion-design.md` §L3). L1 (coverage-metric policy filtering) and L2 (rendered-DOM adaptive discovery) already shipped to `origin/main`. L3 raises two env-defaulted count bounds consumed by `hybridCrawl` (`HYBRID_CRAWL_MAX_FETCHES` 400→800, `HYBRID_CRAWL_MAX_ADDED` 300→600), documents the wave-arithmetic headroom that makes this safe under the unchanged 120 s raw sub-budget, and adds regression tests proving `stoppedBy`/`capped` semantics are unchanged at the new magnitudes. It makes **no** change to the crawl time budget, the L2 rendered pass, the absolute discovery deadline, or `prisma/schema.prisma`.

**Tech Stack:** TypeScript, Next.js 15, Vitest, Prisma/SQLite. Pure functions + injected-deps tests; no new dependencies.

## Global Constraints

- **Node 24** on production; **SQLite only**; **no serverless** (RunCloud + PM2).
- **Gates are the ONLY type-check gate** (in-build tsc/lint disabled): `npm run lint` (tsc --noEmit) + `DATABASE_URL="file:./local-dev.db" npm test` (vitest) + `npm run build` (heap-capped — never bare `next build`). Never merge without all three green in this session.
- **No AI/LLM API** features (standing decision, 2026-07-08).
- **Never raise `BROWSER_POOL_SIZE` above 4.** L3 touches only the raw-HTTP crawl (no Chrome), so memory is not affected — but do not "help" by raising pool size.
- **Never scan non-client sites.** Prod verification uses only client domains already in the system; the canary (`proway.erstaging.site`) is noindex and cannot exercise raw-HTML discovery — use the named real clients.
- **All env tunables are default-safe** (parsed via `parsePositiveInt` with a literal default) — no prod `.env` step is required to deploy L3; the new defaults ship in code.
- **Honesty rule (Codex F4/F6):** a run that stops at a raised cap must still be honestly reported (`coverage.stoppedBy` carries the truth); a client that no lever can bring to ≤5% is labeled `sf-required` in the ledger, never a silent pass. L3 must not weaken this.

---

## File Structure

L3's code surface is deliberately tiny — two default literals, one extracted testable helper, tests, and docs.

- `lib/ada-audit/sitemap-crawler.ts` — **modify.** Raise the `HY_MAX_ADDED` / `HY_MAX_FETCHES` env defaults (lines 32–33); extract the inline raw-crawl `CrawlBounds` construction (currently lines 396–405 inside `discoverPagesWithDeps`) into a small exported, unit-testable helper `resolveRawCrawlBounds(deadlineMs, now)`; add a wave-arithmetic doc comment. No behavior change beyond the two default values.
- `lib/ada-audit/sitemap-crawler.test.ts` — **create if absent / modify.** Unit-test `resolveRawCrawlBounds` returns the new count defaults with env unset (red→green on the value change), and that the raw sub-budget stays `min(120 s, remaining-deadline)` (unchanged).
- `lib/ada-audit/seo/hybrid-crawl.test.ts` — **modify.** Add magnitude regression cases: `hybridCrawl` stops at `maxAdded: 600` (`stoppedBy: 'maxAdded'`) and `maxFetches: 800` (`stoppedBy: 'maxFetches'`) with a generated wide graph — guarding against any hidden fixed-size assumption.
- `lib/ada-audit/seo/discovery-coverage.test.ts` — **verify (likely no change).** Confirm the existing `capped` derivation is independent of `maxAdded`/`maxFetches` stops (only `hardCap`/`seedCapped`/`hardCapPrefull` set `capped`); add an assertion if not already covered.
- `.claude/skills/er-seo-tools-config-and-flags/` (SKILL.md or its reference) — **modify if it lists these defaults.** Update the documented defaults for `HYBRID_CRAWL_MAX_FETCHES`/`HYBRID_CRAWL_MAX_ADDED`.
- `docs/superpowers/todos/2026-07-05-sf-live-parity-log.md` — **append.** L3 before/after ledger scaffold (filled during prod re-measure).
- Tracker + HANDOFF — updated in the closing ritual (not a TDD task).

**Deferred (NOT in L3):** the spec's "option (a)" freed-budget consumption for time-bound raw-HTML sites (Beal, and soma insofar as it is time-bound). See the "Beal / time-bound decision" note below — this is a data-gated follow-up, not L3 scope.

---

## Beal / time-bound decision (recorded rationale — do not implement in L3)

The spec (§L3, Codex F6) requires a decision between (a) letting a productive raw crawl consume the freed rendered-pass budget and (b) dropping Beal from L3's expected effect. **This plan chooses (b)**, for reasons grounded in the current code:

- **Overall vs raw budget:** the discover job passes `timeBudgetMs = DISCOVER_JOB_TIMEOUT_MS (300 s) − elapsed − INSERT_RESERVE_MS (60 s)` ≈ **~240 s** as the overall discovery deadline (`site-audit-discover.ts:166–168`). The raw crawl self-caps at `min(HY_TIME_BUDGET = 120 s, remaining)` = **120 s** (`sitemap-crawler.ts:400`). So a raw-HTML site (no rendered pass) leaves **~120 s of the overall budget unused** — real freed headroom.
- **Why not implement (a) now:** a *reserve-based* raw-budget raise trades directly against the rendered pass — a JS-blind site's rendered BFS (`HYBRID_RENDER_MAX_FETCHES` 40 @ concurrency 2) needs ~100 s, and a raw-productive site wants that same time; there is no single reserve size that serves both. The clean form (run raw at 120 s, probe, then *resume* the raw crawl only when the probe returns no-render) requires making `hybridCrawl` resumable — a refactor of the crawl core the L2 change just stabilized. Neither is "the small increment" L3 is scoped to be, and both reopen the L2 deadline plumbing.
- **Why (b) is safe/honest:** Beal's 6.9 % residual predates L1's content-filtering, which strips exactly the pagination/param/thank-you noise Beal likely carried — Beal may already be ≤5 % post-L1. We do not yet have the post-L1+L2 re-measure. L3 explicitly does **not** claim its cap raises help Beal (Codex F6 forbids that claim). The prod re-measure (below) records Beal's real post-L1+L2+L3 number.
- **Follow-up trigger:** if the re-measure shows soma or Beal (or any raw-HTML site) still >5 % **and** `coverage.stoppedBy === 'timeBudget'** (time-bound, not cap-bound), open a separate spec for the resume-based freed-budget consumption — its own Codex review, its own PR. Fail-closed: such a client stays `sf-required` in the ledger until then; its N=8 clock does not start.

---

## Task 1: Raise the raw-crawl count-cap defaults (extract + test the resolver)

**Files:**
- Modify: `lib/ada-audit/sitemap-crawler.ts:32-33` (default literals), `:396-405` (extract bounds construction)
- Test: `lib/ada-audit/sitemap-crawler.test.ts`

**Interfaces:**
- Produces: `export function resolveRawCrawlBounds(deadlineMs: number, now: number): CrawlBounds` — reads the `HY_*` env accessors and returns the raw-crawl `CrawlBounds`, with `timeBudgetMs = Math.min(HY_TIME_BUDGET(), Math.max(0, deadlineMs - now))` (behavior identical to the current inline object). `CrawlBounds` is imported from `./seo/hybrid-crawl`.
- Consumes: nothing from other L3 tasks.

- [ ] **Step 1: Write the failing test for the new defaults**

Add to `lib/ada-audit/sitemap-crawler.test.ts` (create the file with this header if it does not exist):

```typescript
// lib/ada-audit/sitemap-crawler.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveRawCrawlBounds } from './sitemap-crawler'

describe('resolveRawCrawlBounds', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    delete process.env.HYBRID_CRAWL_MAX_ADDED
    delete process.env.HYBRID_CRAWL_MAX_FETCHES
    delete process.env.HYBRID_CRAWL_TIME_BUDGET_MS
  })
  afterEach(() => { process.env = { ...saved } })

  it('defaults to the L3 raised count caps (800 fetches / 600 added)', () => {
    const b = resolveRawCrawlBounds(100_000, 0)
    expect(b.maxFetches).toBe(800)
    expect(b.maxAdded).toBe(600)
  })

  it('keeps the raw time sub-budget capped at HY_TIME_BUDGET (120s), not the overall deadline', () => {
    // overall deadline is 240s out; raw crawl must still self-cap at 120s
    const b = resolveRawCrawlBounds(240_000, 0)
    expect(b.timeBudgetMs).toBe(120_000)
  })

  it('clamps the raw sub-budget to the remaining deadline when it is under 120s', () => {
    const b = resolveRawCrawlBounds(30_000, 0)
    expect(b.timeBudgetMs).toBe(30_000)
  })

  it('respects env overrides for the count caps', () => {
    process.env.HYBRID_CRAWL_MAX_FETCHES = '1200'
    process.env.HYBRID_CRAWL_MAX_ADDED = '900'
    const b = resolveRawCrawlBounds(100_000, 0)
    expect(b.maxFetches).toBe(1200)
    expect(b.maxAdded).toBe(900)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/sitemap-crawler.test.ts`
Expected: FAIL — `resolveRawCrawlBounds` is not exported (`does not provide an export named 'resolveRawCrawlBounds'`), and once it exists the first case fails with `800 !== 400` / `600 !== 300` until the defaults are raised.

- [ ] **Step 3: Raise the two default literals**

In `lib/ada-audit/sitemap-crawler.ts`, change lines 32–33:

```typescript
// L3 (2026-07-20): raised from 300/400. Large raw-HTML client sites
// (healthcarecareer hit maxAdded@300; soma hit maxFetches@400) were cut off
// before finishing a productive raw crawl. Wave arithmetic: with
// HYBRID_CRAWL_CONCURRENCY=6, 800 fetches ≈ 134 sequential waves; each wave is
// one concurrent batch of ≤6 fetches (FETCH_TIMEOUT=15s worst case), so a
// healthy host reaches 800 well inside the 120s raw sub-budget, and a slow host
// is still cut by that 120s budget (stoppedBy:'timeBudget') — the count raise
// never removes the time backstop. HARD_CAP (1000) still bounds total pages.
const HY_MAX_ADDED = () => parsePositiveInt(process.env.HYBRID_CRAWL_MAX_ADDED, 600)
const HY_MAX_FETCHES = () => parsePositiveInt(process.env.HYBRID_CRAWL_MAX_FETCHES, 800)
```

- [ ] **Step 4: Extract the exported resolver and rewire the call site**

Add near the other `HY_*` helpers in `lib/ada-audit/sitemap-crawler.ts` (import `CrawlBounds` at the top from `./seo/hybrid-crawl` if not already imported):

```typescript
/** Raw-crawl bounds from env, with the raw time sub-budget clamped to the
 *  smaller of HY_TIME_BUDGET (120s) and the remaining overall deadline. The
 *  120s sub-cap is intentional (reserves the rest of the overall deadline for
 *  the L2 rendered pass); see the L3 plan's "Beal / time-bound decision". */
export function resolveRawCrawlBounds(deadlineMs: number, now: number): CrawlBounds {
  return {
    maxDepth: HY_MAX_DEPTH(),
    maxAdded: HY_MAX_ADDED(),
    maxFetches: HY_MAX_FETCHES(),
    timeBudgetMs: Math.min(HY_TIME_BUDGET(), Math.max(0, deadlineMs - now)),
    hardCap: HARD_CAP,
    maxQueryVariantsPerPath: HY_QUERY_VARIANTS(),
    maxPathSegments: HY_PATH_SEGMENTS(),
    concurrency: HY_CONCURRENCY(),
  }
}
```

Then replace the inline `const bounds: CrawlBounds = { ... }` at lines 396–405 in `discoverPagesWithDeps` with:

```typescript
  const bounds = resolveRawCrawlBounds(deadlineMs, deps.now())
```

- [ ] **Step 5: Run the resolver test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/sitemap-crawler.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 6: Run the full existing crawler suites to confirm no regression from the extraction**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/hybrid-crawl.test.ts lib/ada-audit/seo/discovery-coverage.test.ts lib/ada-audit/sitemap-crawler.test.ts`
Expected: PASS (the extraction is behavior-preserving; only the two default values changed).

- [ ] **Step 7: Commit**

```bash
git add lib/ada-audit/sitemap-crawler.ts lib/ada-audit/sitemap-crawler.test.ts
git commit -m "feat(discovery): L3 raise raw-crawl count caps to 800/600 (extract resolveRawCrawlBounds)"
```

---

## Task 2: Magnitude regression tests for stoppedBy at the new caps

**Files:**
- Test: `lib/ada-audit/seo/hybrid-crawl.test.ts`

**Interfaces:**
- Consumes: `hybridCrawl`, `CrawlBounds`, `FetchedPage` from `./hybrid-crawl`; the existing `HOST`, `B()`, and `graph()` helpers at the top of the test file.
- Produces: nothing.

- [ ] **Step 1: Write the failing (guard) tests at 600/800 magnitudes**

Add to `lib/ada-audit/seo/hybrid-crawl.test.ts` inside the existing `describe('hybridCrawl', ...)` block. These use a generated wide graph (one seed linking to N children) so the caps are actually reached:

```typescript
  it('stops at maxAdded at the L3 magnitude (600)', async () => {
    const children = Array.from({ length: 800 }, (_, i) => `https://x.com/p${i}`)
    const g: Record<string, string[]> = { 'https://x.com/': children }
    for (const c of children) g[c] = []
    const r = await hybridCrawl(
      [{ url: 'https://x.com/', source: 'sitemap' }], HOST,
      B({ maxAdded: 600, maxFetches: 5000, hardCap: 5000 }), graph(g), { disallow: [], allow: [] },
    )
    expect(r.addedByCrawl).toBe(600)
    expect(r.stoppedBy).toBe('maxAdded')
  })

  it('stops at maxFetches at the L3 magnitude (800)', async () => {
    // a chain deep enough that fetching is the binding constraint
    const g: Record<string, string[]> = {}
    for (let i = 0; i < 1000; i++) g[`https://x.com/n${i}`] = [`https://x.com/n${i + 1}`]
    g['https://x.com/n1000'] = []
    const r = await hybridCrawl(
      [{ url: 'https://x.com/n0', source: 'sitemap' }], HOST,
      B({ maxFetches: 800, maxAdded: 5000, maxDepth: 5000, hardCap: 5000, concurrency: 6 }), graph(g), { disallow: [], allow: [] },
    )
    expect(r.fetches).toBeLessThanOrEqual(800)
    expect(r.stoppedBy).toBe('maxFetches')
  })
```

- [ ] **Step 2: Run the tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/hybrid-crawl.test.ts`
Expected: PASS. (These are regression guards — `hybridCrawl` already honors bounds as parameters; the value is proving no fixed-size assumption breaks at 600/800. If either fails, that is a real bug to fix in `hybrid-crawl.ts` before proceeding.)

- [ ] **Step 3: Verify `capped` is independent of the count-cap stops (honesty rule)**

Read `lib/ada-audit/seo/discovery-coverage.test.ts` and `sitemap-crawler.ts:501`. Confirm `capped = seedCapped || crawl.stoppedBy === 'hardCap' || renderStoppedBy === 'hardCapPrefull'` — i.e. `stoppedBy: 'maxAdded'`/`'maxFetches'` does NOT set `capped`; the truth is carried by `coverage.stoppedBy`. If `discovery-coverage.test.ts` does not already assert this, add:

```typescript
  it('a maxAdded/maxFetches stop is reported via stoppedBy, not the coarse capped flag', () => {
    // capped stays false for a count-cap stop; the ledger reads coverage.stoppedBy for the truth
    const cov = computeDiscoveryCoverage({
      discoveredUrls: ['https://x.com/', 'https://x.com/a'],
      internalLinks: ['https://x.com/', 'https://x.com/a'],
      discoveryMode: 'hybrid',
      discoveryCapped: false,
    })
    expect(cov.capped).toBe(false)
  })
```

(Adjust the `computeDiscoveryCoverage` call to match its real signature in `discovery-coverage.ts` — verify the argument shape before writing the assertion; the point is `discoveryCapped:false` in ⇒ `capped:false` out regardless of a count-cap stop.)

- [ ] **Step 4: Run the coverage suite**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/discovery-coverage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/hybrid-crawl.test.ts lib/ada-audit/seo/discovery-coverage.test.ts
git commit -m "test(discovery): L3 magnitude guards for maxAdded/maxFetches stops; capped independence"
```

---

## Task 3: Documentation — config reference + parity-log scaffold

**Files:**
- Modify (if present): `.claude/skills/er-seo-tools-config-and-flags/SKILL.md` (or its reference file)
- Modify: `docs/superpowers/todos/2026-07-05-sf-live-parity-log.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Update the config-and-flags reference if it documents these defaults**

Run: `grep -rn "HYBRID_CRAWL_MAX_FETCHES\|HYBRID_CRAWL_MAX_ADDED" .claude/skills/er-seo-tools-config-and-flags/`
If any hit shows the old `400`/`300` defaults, update them to `800`/`600` with a dated note ("L3, 2026-07-20"). If there are no hits, no change is needed — record that in the commit body.

- [ ] **Step 2: Add the L3 ledger scaffold to the parity log**

Append a dated L3 section to `docs/superpowers/todos/2026-07-05-sf-live-parity-log.md` with a per-client table to be filled during prod re-measure — columns: `client | pre-L3 residualMissRate | post-L3 residualMissRate | stoppedBy | maxAdded/maxFetches hit? | verdict (cleared / still >5% cap-bound / still >5% time-bound → sf-required)`. Pre-populate the rows for `healthcarecareer`, `soma`, `beal`. Include a one-line statement of the Beal/time-bound decision (option (b), follow-up gated on the re-measure).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/er-seo-tools-config-and-flags docs/superpowers/todos/2026-07-05-sf-live-parity-log.md
git commit -m "docs(discovery): L3 config-reference defaults + parity-log ledger scaffold"
```

---

## Rollout & verification (change-control closing — not TDD steps)

- [ ] **Gates (all three, in the worktree):**
  - `npm run lint`
  - `DATABASE_URL="file:./local-dev.db" npm test` (known pre-existing flake to ignore: `components/viewbook/admin/ViewbookEditor.test.tsx > "copies the public URL from the secondary masthead action"` — a parallel-run flake unrelated to discovery)
  - `npm run build`
- [ ] **Codex pre-merge review** (P1 risky-diff) via `codex-review` / background `codex exec` on the branch diff. Apply named fixes.
- [ ] **PR** `feat/hybrid-discovery-L3` → `main`; record the gate output in the body. **`git push` first, then `gh pr merge`; verify the merged tip and prod source** (L2 merge-slip lesson).
- [ ] **Deploy** (autonomous, gate-green): `git push` → `ssh $PROD_SSH "~/deploy.sh"`. No `.env` step — defaults ship in code. **Post-deploy health check is mandatory:** `/api/health` 200, 0 PM2 restarts, RSS within envelope.
- [ ] **Prod re-measure** (the falsifiable gate): re-run the ledger probe for `healthcarecareer`, `soma`, `beal` and read each run's `discoveryCoverageJson.residualMissRate` (policy-filtered, L1) + `discoverySourcesJson.stoppedBy` + `fetches`/`addedByCrawl`. Record before/after in the parity log. Expected: healthcarecareer + soma no longer stop at `maxAdded`/`maxFetches` (should now stop at `exhausted`/`timeBudget`/`hardCap`), residual drops. Beal: record its post-L1+L2+L3 number; if still >5% AND `stoppedBy:'timeBudget'`, label `sf-required` and open the option-(a) follow-up spec (do NOT start its N=8 clock). Prod DB probe = `node` + `PrismaClient` via a scp'd temp script (tsx importing app source hits the `server-only` guard — replicate raw logic inline).
- [ ] **Docs ritual:** tracker checkbox + dated status-log line for the SF-retirement Phase-2 L3 item; rewrite `docs/superpowers/todos/HANDOFF-improvement-roadmap.md` (current state, next item, gotchas) in the **same commit**; end the session reply with the paste-in prompt. On ship, `git mv` the L3 spec + this plan into `docs/superpowers/archive/{specs,plans}/`.

---

## Self-Review

**Spec coverage (§L3):** Part 1 "raise raw-crawl default bounds 400→800 / 300→600 with headroom analysis" → Task 1 (defaults + wave-arithmetic comment). Part 2 "confirm bounds still honestly reported (`stoppedBy`, `capped`)" → Task 2 (magnitude guards + capped-independence). "Time budget stays 120 s" → honored (resolver keeps the 120 s sub-cap unchanged; Task 1 Step 4). Codex F6 Beal decision → recorded as option (b) with a data-gated follow-up (dedicated section + parity-log entry). Tests "add cases at the new default magnitudes; assert stoppedBy/capped unchanged" → Task 2. §8 files touched: `sitemap-crawler.ts` env defaults ✓, `hybrid-crawl.test.ts` cases ✓, config-and-flags reference ✓; "(option a) raw-crawl budget reuse" → deliberately deferred (documented). No `prisma/schema.prisma` change ✓.

**Placeholder scan:** every code step shows the exact code; test bodies are complete; the one "adjust to match the real signature" note (Task 2 Step 3) instructs verifying `computeDiscoveryCoverage`'s argument shape before asserting — the intent (capped independence) and the assertion are concrete.

**Type consistency:** `resolveRawCrawlBounds(deadlineMs, now): CrawlBounds` — same name/signature in the interface block, the implementation (Task 1 Step 4), and the call site rewire. `CrawlBounds`/`FetchedPage` imported from `./hybrid-crawl` as the existing test and module already do. `stoppedBy` values (`'maxAdded'`/`'maxFetches'`/`'timeBudget'`/`'hardCap'`/`'exhausted'`/`'depth'`) match `hybrid-crawl.ts:43`.
