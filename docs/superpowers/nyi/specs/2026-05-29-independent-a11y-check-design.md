# Independent Accessibility Second-Check (IBM Equal Access / ACE) — Design

**Date:** 2026-05-29
**Status:** Reviewed by Codex (ACCEPT WITH NAMED FIXES) — fixes applied 2026-05-29; ready for planning. **Implementation gated on a smoke test (see below).**
**Related:** `2026-05-29-psi-a11y-reframe-design.md` (sibling — provides the PSI-only trigger), `2026-05-15-lighthouse-pagespeed-provider-design.md`

## Goal

Add a **genuinely independent** accessibility check that uses a **different rule engine from axe-core**, runnable **on-demand**, to act as a tie-breaker when our primary axe scan and PSI disagree (and as a deeper, higher-confidence check for high-stakes client reports).

The motivating constraint: PSI accessibility is *itself axe-core*, so it can never be a true independent cross-check (see sibling spec, and the verified Molloy false-positive case). To break ties with confidence we need a second engine whose rules were authored independently of axe.

## Engine choice: `accessibility-checker-engine` (IBM ACE), engine-only

Selected after research + Codex consult. IBM Equal Access ships two packages:

| | `accessibility-checker` (wrapper) | **`accessibility-checker-engine` (ACE)** ✅ |
|---|---|---|
| Dependencies | full `puppeteer ^25`, `chromedriver`, `@ibm/telemetry-js`, exceljs… | **zero** |
| Browser binary | downloads Chrome-for-Testing + chromedriver | **none** |
| Runtime network | fetches rule archives from `cdn.jsdelivr.net` unless cached | **none — bundles rules locally** |
| Disk side-effects | writes report files by default | **none** |
| Use model | own browser lifecycle, baselines, configs | **inject `ace.js`, call `window.ace`** |
| License | Apache-2.0 | **Apache-2.0** |

We use the **engine only**, injected exactly like we inject `axe.min.js` today:

```ts
await page.addScriptTag({ path: ACE_PATH })   // node_modules/accessibility-checker-engine/ace.js
const report = await page.evaluate(async (policy: string) => {
  const checker = new (window as any).ace.Checker()
  const r = await checker.check(document, [policy])
  return r // NOTE: tolerate both r.results and r.report.results — see Output mapping
}, ACE_POLICY)
```

**The policy string is NOT confirmed and must not be baked in** (Codex). IBM's engine README's confirmed example is `['IBM_Accessibility']`; a WCAG-only policy string (candidates: `'WCAG_2_1'`, `'WCAG 2.1 (A,AA)'`) is *not* verified for the engine-only path. Make `ACE_POLICY` configurable and treat confirming it — plus recording `summary.policies` and `summary.ruleArchive` from a real run — as a **hard smoke-test gate** before any wiring. This sidesteps every wrapper drawback. Engine independence from axe is the entire point: its rules derive substantially from the W3C ACT-Rules community, not Deque's axe ruleset.

## Strategy (Codex-vetted)

- **On-demand, NOT always-on.** Do **not** run ACE on every page of a 1000-page site audit — its per-page time/memory is unbenchmarked and the incremental value is unproven. Triggers:
  1. **Single-page "Deep / Independent Check"** button on an `/ada-audit/[id]` result page.
  2. **Auto-trigger (server-side)** when PSI-only a11y findings exist on a single-page audit. This is computed **server-side after the PSI summary is stored** (the PSI worker reads the row's axe result and calls the shared `splitPsiAccessibility` helper from the sibling spec) — *not* at render time, so rendering stays side-effect-free. The trigger enqueues a job only after the atomic status check.
  3. (Optional, later) explicit per-site-audit toggle for high-risk final reports — off by default.

**Dedicated low-concurrency queue (Codex):** ACE jobs run through their own small worker pool (akin to `lighthouse-queue.ts`), capped well below `BROWSER_POOL_SIZE`, so auto-triggered checks cannot starve the main audit pool. Each ACE job acquires one page, runs, releases — bounded concurrency, never unbounded fan-out.
- **ACE findings never feed the compliance score.** They render in a separate **"Independent Review"** block. ACE has no axe-style severity; its `level` is confidence/type, not impact.
- **Run axe and ACE sequentially on one page — never simultaneously.** Both inject globals and read the DOM. A deep-check performs ONE navigation and runs axe → screenshots → ACE in sequence (see below); it does not spin up a second concurrent page.

### Execution model — important correction to the naive "same page as the live audit" idea

The original audit's page is acquired, used, and **released** before PSI (async, off-box) ever returns. So an auto-trigger or button-click cannot reuse that page. The clean model:

**A deep-check is its own self-contained operation** that acquires a fresh page from the existing browser pool, navigates once, and runs both engines sequentially on that single page:

```
acquirePage → goto(url) → postLoadSettle
  → inject axe → run axe → captureViolationScreenshots (axe nodes)
  → record FRESH-render metadata: fresh axe violation IDs, domElementCount, finalUrl, timestamp, ACE engine version
  → inject ACE → run ACE.check → parse + resolve ACE nodes
  → (v2 only) capture ACE-node screenshots — AFTER ACE has resolved its nodes
  → delete window.ace → releasePage
```

This satisfies Codex's "sequential on one page, never concurrent in-page" guidance, reuses the pool (no extra memory ceiling pressure), and produces a directly comparable axe-vs-ACE-vs-PSI view on one consistent render. Because it re-navigates, the deep-check render may differ from the original audit's render — which is desirable for a tie-breaker (a fresh independent look), and is disclosed in the UI.

**Screenshot ordering (Codex fix):** ACE screenshots cannot reuse the axe-screenshot pass, because that pass runs *before* ACE has produced any nodes. Options: (a) **v1 — omit ACE-node screenshots** (show snippet + selector/XPath only); (b) **v2 — a second screenshot pass after ACE resolution.** v1 omits them to keep scope tight.

**Fresh-render metadata (Codex fix):** because the deep-check re-navigates, comparing fresh ACE against the *original* (possibly stale) audit's axe result is misleading. Store the deep-check's **own** fresh axe snapshot (at minimum the violation IDs + `domElementCount` + `finalUrl` + timestamp + ACE engine version) so the three-way comparison is apples-to-apples on one render.

ACE runs **strictly last** (after axe + axe screenshots + any PDF harvest) so it cannot perturb the DOM those depend on. Teardown: `delete window.ace`, then page release/navigation.

## Output mapping

**Parsing (Codex):** the result shape is not certain — IBM docs show a wrapped report with `summary` + `results`. Tolerate **both** `report.results` and `report.report.results`; capture `summary.policies` / `summary.ruleArchive` for traceability. ACE `results[]` entries: `{ ruleId, reasonId, value: [TYPE, OUTCOME], level, path: { dom: XPath, aria }, message, snippet }`. There is **no impact field**.

**Switch on `level` (and `value[1]`) explicitly — do NOT pre-filter to `value[1] === 'FAIL'`** (that was a contradiction in the draft: it would drop the very `POTENTIAL`/`MANUAL` items mapped below). Partition by `level`:

- `level: 'violation'` → display tier "Violation"
- `level: 'potentialviolation'` → display tier "Needs review (potential)"
- `level: 'recommendation' | 'potentialrecommendation'` → display tier "Recommendation"
- `level: 'manual'` → **separate "Manual review needed" list**, never merged into findings
- `level: 'pass'` → ignore

**These tiers are independent-review TYPE/CONFIDENCE labels, NOT axe-style severity, and NEVER feed any score** (Codex). Do not present them as `critical/serious/moderate/minor`. If an internal `impact`-shaped field is needed only to reuse existing list components, derive it for *display* and label the whole block "Independent Review (IBM Equal Access) — informational, not scored."
- **XPath → our `nodes: [{ html, target }]`:** resolve `path.dom` in-page while the DOM is live:
  ```ts
  const el = document.evaluate(xpath, document, null,
    XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as Element | null
  // emit { html: el.outerHTML, target: cssSelectorFor(el) }
  ```
  If selector generation fails (text/SVG/detached node), still store the finding with `html` + raw XPath, flagged **non-screenshotable**.
- `id ← ruleId`, plus keep `message`, `reasonId`, raw `path.dom` for traceability.

## Storage

**Prefer a separate `AdaIndependentCheck` table** (Codex), keyed by `adaAuditId`, rather than columns on `AdaAudit` — so we can support re-runs, history, and additional engines later without reshaping `AdaAudit`. (Per-row columns are acceptable *only* if we commit to "latest run only" and accept a future migration to add history.)

Proposed `AdaIndependentCheck` (Prisma; planning finalizes names):

- `id`, `adaAuditId` (FK), `engine` (`'ibm-ace'`), `engineVersion`, `policy`, `ruleArchive`
- `status` — `running | complete | error` (row existence = "has been run")
- `result` — `String?` (JSON: normalized findings by tier + manual-review list)
- `freshRender` — `String?` (JSON: fresh axe violation IDs, `domElementCount`, `finalUrl`, timestamp — the apples-to-apples comparison snapshot from §Execution model)
- `error`, `createdAt`, `completedAt`

**Atomic status transition (Codex):** launching a deep-check must be a compare-and-set — only transition `absent / error / complete → running` (e.g. `createMany`-if-absent or an `updateMany` guarded on prior status), so repeated button clicks, poll races, or a duplicate auto-trigger cannot launch two concurrent browser jobs for the same audit.

The result is pollable like the main audit (client polls until `status` is `complete`/`error`).

## UI

- A **"Deep / Independent Check"** button on the single-page result view (near the existing Re-scan button), with its own poll for `independentCheckStatus`.
- An **"Independent Review (IBM Equal Access)"** result block, clearly labeled as a different engine and explicitly *not* part of the compliance score. Three-way framing where relevant: *axe found X · PSI-only flagged Y · IBM ACE found Z*.
- **Corroboration must be cautious (Codex):** ACE `ruleId`s are **not** the same identifiers as axe/Lighthouse rule IDs, so we cannot claim "ACE confirms this PSI-only item" by ID equality. Correlating findings requires mapping on **WCAG success-criterion** (both engines expose SC mappings) or element-level/manual judgment — never exact rule-ID match across engines. v1 may simply present the three lists side-by-side and let the operator judge, deferring automated SC-level correlation to a later iteration.
- **v1 omits ACE-node screenshots** (see Execution model); show snippet + selector/XPath. A later pass can add an ACE screenshot step.

## Non-goals (out of scope)

- The `accessibility-checker` **wrapper** (binaries, telemetry, CDN, disk writes).
- **Always-on** ACE in site audits / per-page on 1000-page crawls.
- **Feeding ACE findings into the compliance score** or the `compliant` flag.
- Running axe and ACE **concurrently** on a single page.
- A standalone ACE-only route — ACE is an augmentation of an existing audit, not a new tool.

## Smoke-test gate (must pass before merge)

Per Codex, ACE's per-scan cost and output quality are unbenchmarked. Before wiring any UI/persistence, prototype on ~10 representative URLs (3 clean, 3 known-bad, 2 consent/third-party-heavy, 2 that produced PSI disagreement — incl. the Molloy page):

1. Measure added wall-time and page memory (axe-only vs axe+ACE).
2. Confirm `ace.js` injects from local `node_modules` on the production server.
3. Confirm ACE makes **no** network requests at runtime (verify bundled rules).
4. Confirm `puppeteer-core` `Page` is accepted by the injection path (research could not verify wrapper↔puppeteer-core; engine-injection should be agnostic, but verify).
5. Confirm `delete window.ace` + navigation fully tears down; no DOM mutation vs. pre-ACE screenshots.
6. Validate XPath→element resolution across normal HTML, consent banners, SVG/icon buttons, hidden elements, iframes.
7. Human-review a sample of ACE findings before exposing them as client-facing issues (calibrate the `level`→impact table and the manual-review bucket).

## Resolved by Codex review (2026-05-29)

1. **Do not bake in `WCAG_2_1`.** `IBM_Accessibility` is the only confirmed example; verify the WCAG-only policy during the smoke test and record `summary.policies` + `summary.ruleArchive`. Policy is configurable + a smoke-test gate.
2. **Prefer a separate `AdaIndependentCheck` table** (history/reruns/multiple engines). Per-row columns only if explicitly "latest run only."
3. **Auto-trigger is server-side, not render-time** — compute the PSI-only split after PSI is stored (shared helper) and enqueue only after an atomic status check.
4. **No reusable selector generator exists** in the screenshot pipeline (it consumes axe-provided selectors). Prefer **XPath-based lookup first** for resolving/locating ACE nodes, with a minimal generated CSS selector only for display/fallback.

Additional named fixes applied above: tolerant result parsing (`results` vs `report.results`); switch on `level` (don't pre-filter to `FAIL`); independent-review tiers are type/confidence, never scored severity; ACE-screenshot ordering (v1 omits); store fresh deep-check render metadata + fresh axe snapshot; atomic compare-and-set status; dedicated low-concurrency ACE queue; corroboration via WCAG-SC mapping, not cross-engine ID equality.
