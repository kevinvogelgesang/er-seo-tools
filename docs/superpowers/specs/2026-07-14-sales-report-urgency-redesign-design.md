# Sales Report Urgency Redesign — Design

**Date:** 2026-07-14
**Status:** Approved by Kevin (chat), pending Codex review
**PR:** 2 of 3 (sales-audit overhaul series — depends on PR 1's `Explainer` component)

## Problem

The C14 public sales report (`/sales/[token]`) is honest but flat: a text header, four score tiles, and four collapsed `<details>` sections. Kevin wants it rebuilt around **urgency and personalization** so it works as a meeting leave-behind: a branded always-visible header with a booking CTA, an above-the-fold hero (their homepage screenshot + a big animated overall-score gauge), urgency-bar visuals, per-section "why this hurts you" copy, score-methodology explainers, and an inquiry form replacing the mailto footer.

## Decisions already made (Kevin, chat 2026-07-14)

- **Book a review CTA** smooth-scrolls to the inquiry form at the page bottom (`#inquiry`). No external booking URL.
- **Overall gauge blend** = simple average of the available headline scores (Accessibility, SEO, Performance, Structured-data coverage %); null metrics excluded from the denominator. Server-computed.
- **Homepage screenshot** is captured at scan time; reports from older scans hide the slot (gauge takes full width) until re-scanned. No placeholder card.
- **Logo** pulled from enrollmentresources.com and committed to `public/` (light/dark safe).
- **Accessibility section** shows counts only — no itemized rules (the pattern `<details>` cards and their element screenshots leave the report).
- **Inquiry form** is a placeholder for a future embedded Jotform.

## Non-goals

- No change to what the scan measures, to scoring formulas, or to the `selectRuns` canonical-run rules.
- No AI/LLM features (standing 2026-07-08 decision).
- No compliance claims about the *prospect's* site ("WCAG compliant", "CWV pass" stay banned). The new CTA claims ADA compliance about **Enrollment Resources' own product sites** — Kevin-approved marketing copy, allowed.
- Print stays workable (static header, no broken layouts) but is not a designed deliverable.
- The existing element-screenshot route + `curatedScreenshotSet` allowlist stay in place (other consumers/back-compat); the report simply no longer renders element screenshots.

## Design

### 1. Homepage hero screenshot (pipeline)

**Storage — NOT under `SCREENSHOTS_DIR`.** The screenshot sweeper deletes per-child-audit dirs `SCREENSHOT_RETENTION_MS` (default 24 h) after completion; a hero image must survive the 30-day sales token. Follow the `REPORTS_DIR` precedent:

- New module `lib/sales/hero-screenshot.ts`: `HERO_SCREENSHOTS_DIR` (env `HERO_SCREENSHOTS_DIR`, default `path.join(process.cwd(), 'sales-hero')`; prod `${DATA_HOME}/sales-hero`), `heroScreenshotPath(siteAuditId)` → `<dir>/<siteAuditId>.png`, atomic write (temp + rename), ENOENT-tolerant delete.
- **Schema:** nullable `SiteAudit.homepageScreenshot String?` (stores the filename, stamped only after a successful file write). One additive migration.
- **Capture seam:** the `site-audit-page` job passes a new optional `heroScreenshot: { path: string }` to `runAxeAudit` when (a) the parent audit's `prospectId != null` and (b) the page URL is the site root (scheme-insensitive, `www.`-insensitive host match against `SiteAudit.domain`, path `/` or empty, no query). The runner captures a **viewport** PNG (`page.screenshot()`, `fullPage: false`) right after `postLoadSettle`, before axe. Wrapped in try/catch — a capture failure logs and never fails the page job. On success the handler stamps `homepageScreenshot` (plain update; last-writer-wins is fine — one homepage per audit).
- **Deletion:** wired into the same seams as report PDFs — the SiteAudit DELETE path and any place that removes the audit row. Prospect audits are manual-class (never retention-pruned), so lifetime ≈ audit lifetime. Files are ~100–300 KB; accumulation across re-scans is acceptable.

### 2. Hero screenshot serving (public route)

- `GET /api/sales/[token]/hero/[siteAuditId]` — validates the sales token, then authorizes the **pinned** `siteAuditId`: `siteAudit.prospectId === prospect.id` AND `homepageScreenshot != null`. Streams the PNG (`Cache-Control: private, max-age=3600`). Every failure → 404. `withRoute`-wrapped.
- **Middleware:** one new anchored single-segment matcher `^/api/sales/[^/]+/hero/[^/]+$` beside the existing screenshot matcher. NEVER a prefix (standing C14 rule).

### 3. Loader additions (`lib/sales/sales-report-data.ts`)

- `overallScore: number | null` — rounded simple average of available headline values (schema coverage participates as its 0–100 pct). Null when no metrics exist.
- `heroScreenshot: boolean` (view builds the URL from `auditId`, which it already has).
- `standardTested: string` — from `wcagLevel`: `wcag21aa` → "WCAG 2.1 AA", `wcag22aa` → "WCAG 2.2 AA + best practices".
- `performance.homepage: { performance: number; lcpMs: number; cls: number; tbtMs: number; lcpStatus; clsStatus; tbtStatus } | null` — the Lighthouse child row whose URL is the site root (same root-matching helper as capture).
- `cwv-aggregate.ts`: `worstPages` cap 3 → **5** (sales view is its only consumer).
- Accessibility patterns/examples: **dropped from `SalesReportData`** (counts stay). `loadRepresentativeExamples` remains used by `curatedScreenshotSet` only.

### 4. View — header (`components/sales/SalesReportHeader.tsx`, client)

Sticky (`position: sticky; top: 0`), full-width, above everything:
- ER logo (`public/er-logo.svg` — fetched from enrollmentresources.com during implementation; if the mark is dark-on-transparent, ship a dark-mode treatment: second asset or CSS-safe recolor. Kevin eyeballs both modes before merge).
- "Website Audit Report" title; "Prepared for {name} · {domain}"; "By {createdBy} @ Enrollment Resources" (createdBy null → just "By Enrollment Resources").
- **Book a review** button (always visible) → `scrollIntoView({ behavior: 'smooth' })` on `#inquiry` (respects reduced-motion via `motion-safe` behavior choice).
- On scroll past a threshold (~80px) the header shrinks smoothly (padding/type-size CSS transitions on a `scrolled` state class; passive scroll listener). Print: static, unshrunk.

### 5. View — hero row

Grid `md:grid-cols-[2fr_3fr]`; single column on mobile.
- **Left — screenshot card:** faux-browser chrome (dot row + domain bar), the hero PNG `object-cover object-top`, rounded card. Rendered only when `heroScreenshot`; when absent the gauge spans full width.
- **Right — `ScoreGauge` (client):** large SVG arc gauge (~240° sweep). Animation timeline on mount: needle+arc **rev** 0 → 100 with an ease-in "engine pull" (~0.9 s) → hold a beat (~0.2 s) → **fall back** to the real score with a slight overshoot/bounce settle (~0.8 s). The numeric readout ticks in sync (rAF-driven single timeline; no animation library). Arc color tracks the current needle value through the house grade thresholds (red < 60, amber 60–89, green ≥ 90 — `gradeForScore`). `prefers-reduced-motion`: render the final state immediately. Caption: "Overall score — average of the four audit areas below."
- **Below (full width):** the four metric tiles (restyled `HeroTiles`) with mini urgency bars (score/100 fill in grade color) tying them visually to the gauge.

### 6. View — sections

All four sections keep `SectionCard`'s grade-chip language but become **open by default** (urgency content shouldn't hide behind a click on a leave-behind; progressive disclosure remains for explainers and long lists). Each section gets a "How this score is calculated" `Explainer` (PR 1 component) with plain-English methodology copy.

- **Accessibility:** severity count tiles (critical / serious / moderate / minor — large red-tiered numerals, total line). No itemized rules. A "tested against {standardTested}" line + 1–2 sentences on what ADA/WCAG conformance means. Salesly CTA block (in `copy.ts`): every website Enrollment Resources builds is ADA-compliant — framed as "this is fixable, we do it as standard".
- **SEO:** each issue group renders as an urgency row — label, count, **`UrgencyBar`** (affected/total pages red fill; animated width on mount, motion-safe), and a one-line "why this hurts you" from a new `ISSUE_WHY: Record<type, string>` in `copy.ts` (e.g. broken links → "dead ends for both students and search crawlers — link equity and trust leak away"). Duplicate-content + sitemap-miss callouts keep their lines, restyled as urgency callouts.
- **Performance:** (a) **Homepage CWV card** — the homepage's own LCP / CLS / TBT + Lighthouse score, each color-coded by its status; (b) **5 slowest pages** list with score bars; (c) the averaged roll-up (median score, p75 LCP/CLS/TBT, % passing) as color-coded stat tiles using Lighthouse lab thresholds (LCP ≤ 2.5 s good / > 4 s poor; CLS ≤ 0.1 / > 0.25; TBT ≤ 200 ms / > 600 ms). Copy keeps "Lighthouse-measured (lab)" honesty.
- **Structured data:** a 2×2 card grid — one card per high-value type (Organization, Course, FAQPage, BreadcrumbList): big ✓ (green) or ✗ (red), type name, one-line implication of absence (new `SCHEMA_IMPLICATIONS` map in `copy.ts`, e.g. FAQPage → "AI assistants can't quote your answers to applicant questions"). Coverage stat + observed-pages line retained below; other observed types stay as chips.

### 7. View — inquiry form (`components/sales/InquiryForm.tsx`, client)

`id="inquiry"`, replaces the mailto footer card. Name / email / phone / message fields + submit. **Placeholder behavior:** submit composes a `mailto:` to `SALES_CONTACT_EMAIL` with the fields prefilled in the body (works today, zero backend). The card is structured so the future Jotform embed swaps in behind the same section shell. A small "prefer email?" mailto link remains for no-JS/print.

### 8. Copy (`lib/sales/copy.ts`)

New: `ISSUE_WHY`, `SCHEMA_IMPLICATIONS`, `SCORE_METHOD` (overall / accessibility / seo / performance / structured-data explainer copy), `ER_ADA_CTA`, standard-label helper. Honesty rules header comment extended: prospect-site compliance claims stay banned; the ER-product ADA claim is the one sanctioned exception.

## Error handling

- Hero capture: never fails the page job; column stays null → slot hidden.
- Hero route: all failure modes → 404 (no distinguishable oracle).
- Gauge with `overallScore === null`: renders an em-dash state, no animation.
- Homepage CWV missing (no LH row for root): card shows "not measured on the homepage — see site-wide numbers below".
- Archived audits: counts + scores still render (findings fallback); screenshot/inquiry unaffected.

## Testing

- `hero-screenshot.ts` unit (path building, atomic write, tolerant delete); root-URL matcher unit (www/scheme/trailing-slash/query cases).
- Loader tests: `overallScore` averaging incl. nulls; homepage CWV resolution; `worstPages` cap 5; patterns absent from the payload.
- Hero route tests: invalid token / wrong prospect's audit / null column → 404; happy path streams.
- Component tests: header renders CTA + anchor target exists; gauge reduced-motion renders final value; sections render counts-not-rules, schema ✓/✗ grid, inquiry form fields.
- Middleware test: new matcher is public; `/api/sales/prospects` still gated.
- Gates: `tsc --noEmit` + vitest; migration via `prisma migrate dev`.
