# C11 PR 3 — `/seo-parser` → `/seo-audits` rename + section maturation + live-scan polish

**Status:** design
**Date:** 2026-07-08
**Author:** C11 PR 3 execution session
**Tracker item:** C11 (h) — the FINAL PR of the C11 arc. Ships ⇒ C11 flips to `[x]`.
**Branch:** `feat/c11-pr3-seo-audits` (off `origin/main` @ `a7ecaa0`)

---

## 1. Context

C11 delivers "SEO Audits v1". PRs 1 (`seoOnly` scan mode), 2a (intent toggles/labels),
and 2b (SEO-phase visibility + progress) are shipped, deployed, prod-verified. What
remains is item (h): **rename the tool surface from `/seo-parser` to `/seo-audits`,
mature it to structurally mirror the ADA-Audit section, and fix a live-scan results
polish bug** — so SEO audits feel like a first-class tool rather than a CSV parser.

Two facts shape every decision here:

- **`seo-parser` means two unrelated things.** `/seo-parser` is a **URL path**.
  `tool: 'seo-parser'` is a **persisted `CrawlRun.tool` discriminator** threaded
  through `lib/findings`, `lib/services`, and job handlers. This PR renames the URL
  and **never touches the data value**.
- **The rename is protected by a permanent redirect.** Because old paths 308 to new
  ones forever, a *missed* internal `/seo-parser` link still resolves correctly. The
  redirect is both the compatibility guarantee for external links (bookmarks, shipped
  srt_ handoff "Webapp:" lines) and a safety net for the internal string swap.

## 2. Goals / Non-goals

**Goals**
1. `/seo-parser` and all subpaths (`/diff`, `/results/[sessionId]`, `/results/run/[runId]`)
   become `/seo-audits`; the sidebar/footer label becomes "SEO Audits".
2. Old `/seo-parser*` URLs 308-redirect to `/seo-audits*` permanently.
3. A fresh live-scan result at `/seo-audits/results/run/[runId]` reads as a first-class
   result, not "Archived — rebuilt from findings data".
4. The SEO-audits index structurally mirrors the ADA-audit index (tabbed "New audit"
   card, wider layout), reusing existing components.

**Non-goals (explicitly OUT of v1)**
- Renaming the `tool: 'seo-parser'` data value, the `components/seo-parser/` directory,
  `@/lib/seo-parser/*` module paths, or the `/api/parse/*` + `/api/seo-parser/*` API
  routes. (Tracker: "API routes stay put in v1.")
- Restructuring the results page (`ResultsView`) into ADA-style section blocks —
  `ResultsView` is shared with the public `/share/[token]` view; deferred.
- Any schema migration. This PR is migration-free.
- Behavior/data/API changes to the scan or parse pipelines.

## 3. Rename mechanics

### 3.1 Route folder move (`git mv`, preserves history)

`app/(app)/seo-parser/**` → `app/(app)/seo-audits/**` — all 8 files:

```
seo-parser/page.tsx
seo-parser/diff/page.tsx
seo-parser/results/[sessionId]/page.tsx
seo-parser/results/[sessionId]/result-json.ts
seo-parser/results/[sessionId]/result-json.test.ts
seo-parser/results/[sessionId]/components/PillarAnalysisButton.tsx
seo-parser/results/[sessionId]/components/PillarAnalysisButtonClient.tsx
seo-parser/results/run/[runId]/page.tsx
```

Their internal `/seo-parser` hrefs update to `/seo-audits` in the same move.

### 3.2 Link-string swap (`/seo-parser` → `/seo-audits`) — authoritative inventory (main)

**Nav / chrome**
- `lib/tools-registry.ts` — `name: 'SEO Parser'`→`'SEO Audits'`; `href` + both children hrefs
  (`/seo-parser`, `/seo-parser/diff`); the internal `id: 'seo-parser'` **stays** (internal key,
  not user-visible; changing it is churn with no benefit — see §3.4).
- `components/footer.tsx` — `{ name: 'SEO Parser', href: '/seo-parser' }`.

**Scan-trigger + routing handoffs**
- `components/ada-audit/SiteAuditForm.tsx:195,256` — `/seo-parser?scan=` → `/seo-audits?scan=`.
- `components/widgets/QuickSiteAuditWidget.tsx:30` — same.
- `components/seo-parser/SeoScanForm.tsx:39` — `replaceState(..., '/seo-parser')` → `/seo-audits`
  (must move with the page or the URL bar shows a stale path that 308s on refresh).
- `components/seo-parser/SeoScanForm.tsx:230` — `View SEO results` href.

**Result / history links**
- `components/seo-parser/HistoryList.tsx:232-233`; `components/seo-parser/ResultsView.tsx:116`.
- `components/widgets/RecentParsesWidget.tsx:25-26`; `components/widgets/QuickParserWidget.tsx:18`.
- `components/clients/IssueTrendCard.tsx:35` (diff link); `components/clients/ScheduledScansCard.tsx:198`.
- `app/(app)/pillar-analysis/[id]/page.tsx:68`.
- `lib/services/client-dashboard.ts:176,190`; `client-findings.ts:62-63`; `scorecard-shared.ts:74-75`.

**seoOnly routing — BEHAVIORAL hrefs** (Codex-flagged; the grep surfaced their comment
lines but the actual `active.seoOnly ? '/seo-parser' : …` href is a line or two below —
these are functional links, not comments, and each has a test asserting the target):
- `app/(app)/ada-audit/site/[id]/seo-only-redirect.ts:5` — `seoOnlyRedirectTarget()`
  returns `'/seo-parser'` for a seoOnly audit (the ADA site page **server-redirects**
  seoOnly audits here). → `'/seo-audits'`. Update its test `seo-only-redirect.test.ts`.
- `components/widgets/LiveNowWidget.tsx:40` — `active.seoOnly ? '/seo-parser' : …`.
- `components/ada-audit/QueueMemberRow.tsx:69` — `member.seoOnly ? '/seo-parser' : …`.
- `components/ada-audit/DashboardQueueStatus.tsx:131` — `active.seoOnly ? '/seo-parser' : …`.

**Comments only** (accuracy — update text, no behavior): the comment lines adjacent to the
four hrefs above, `lib/ada-audit/types.ts`, `lib/services/scorecard-shared.ts` doc comment,
`lib/services/client-dashboard.ts:196`, `app/api/seo-parser/run/[runId]/pages/route.ts:5-6`.

No hidden string concatenations exist (Codex grep-confirmed: `'/seo-' + 'parser'` etc. —
none; all dynamic cases contain a literal `/seo-parser` and were surfaced by grep).

**Skill handoff**
- `skills/er-handoff-memo/SKILL.md` (srt_ "Webapp:" line `{Webapp}/seo-parser/results/{sessionId}`)
  and `skills/er-handoff-memo/templates/screaming-frog-setup.md` → `/seo-audits`. New memos
  emit the new path; already-shipped memos with the old path still resolve via redirect.

### 3.3 Kept unchanged (must NOT be swapped)

- `tool: 'seo-parser'` / `tool === 'seo-parser'` everywhere (persisted data).
- `/api/parse/*`, `/api/seo-parser/*` route paths and the `fetch()` calls to them
  (`components/seo-parser/PagesTable.tsx:86-87`).
- `components/seo-parser/` directory + all `@/components/seo-parser/*` imports;
  `lib/seo-parser/client-upload.ts` + `@/lib/seo-parser/*` imports.

### 3.4 Directory / id naming decision

Keep `components/seo-parser/`, `lib/seo-parser/`, and nav `id: 'seo-parser'`. Rationale:
directory/import churn is invisible to users, touches dozens of import lines, and risks
a broken build for zero user-facing gain; the nav `id` is an internal key. The *surface*
(routes + labels) is what "matures"; the module layout is an implementation detail.

## 4. Redirect design

`next.config.ts` gains:

```ts
async redirects() {
  return [
    { source: '/seo-parser', destination: '/seo-audits', permanent: true },
    { source: '/seo-parser/:path*', destination: '/seo-audits/:path*', permanent: true },
  ]
}
```

- **Order:** Next.js runs `redirects()` **before** middleware. Flow: request `/seo-parser/x`
  → 308 `/seo-audits/x` → middleware auth-gates `/seo-audits/x` (cookie or `?next=` login).
  No auth regression: `/seo-audits*` is not public, exactly as `/seo-parser*` was not.
- **Query preserved** by Next's 308 (`?scan=`, `?a=&b=` on diff survive). URL fragments
  (`#…`) are client-only and never sent to the server — do not assert hash preservation in
  redirect tests (Codex note); no current `/seo-parser` link relies on a fragment.
- **Public share paths untouched** — the SEO public share is `/share/[token]` (not under
  `/seo-parser`); `/ada-audit/*` shares unaffected. No `isPublicPath` change.
- **Tests:**
  - `next.config.test.ts` — assert `redirects()` contains both rules with `permanent: true`
    and the `:path*` wildcard maps to the `:path*` destination.
  - `middleware.test.ts` — assert `/seo-audits` and `/seo-audits/results/x` are **not**
    `isPublicPath` (still auth-gated), guarding against an accidental public-path leak.

## 5. Live-scan polish (archived banner)

**Bug:** `buildSeoResultFromRun` (`lib/findings/seo-findings-fallback.ts`) hardcodes
`archived: true`. `loadRunSeoResult` (the live-scan run loader) uses it, so **every fresh
live-scan run** renders `ResultsView`'s `ArchivedSessionBanner` ("Archived — rebuilt from
findings data") — misleading, because a live scan has no `Session.result` blob *by design*,
not because it was pruned.

**Fix (minimal, typed) — two coordinated parts:**

*Part A — builder param.* Add `buildSeoResultFromRun(..., { archived: boolean })`.
`loadArchivedSeoResult` (session prune fallback) passes `archived: true`; `loadRunSeoResult`
passes `archived: false`. `loadRunSeoResult` already filters `run.tool === 'seo-parser'`.

*Part B — explicit live-scan branch in `ResultsView` (REQUIRED — Codex catch).* Flipping
`archived` to `false` alone is **not enough**: `ResultsView` currently renders
`ArchivedSessionBanner` when `result.archived`, and **otherwise calls `computeCompleteness(result)`**
→ for findings-only live-scan data that misclassifies as "internal crawl missing" and shows
a false completeness/degraded banner. So the live-scan path must be its own branch:
- Derive `const isLiveScan = !!runId && !sessionId` in `ResultsView` (a live-scan run is
  passed `runId` and no `sessionId`; the archived-session fallback is passed `sessionId`).
- When `isLiveScan`: render a small neutral "Live SEO scan" source note and **skip BOTH**
  `ArchivedSessionBanner` **and** the `computeCompleteness()` completeness banner.
- When `!isLiveScan`: unchanged — archived sessions still show `ArchivedSessionBanner`
  (`result.archived === true`), non-archived SF sessions still compute completeness.

The note can reuse/extend `SeoSourceBadge` (already imported for run mode) or a tiny new
presentational sub-component.

**No regression elsewhere (Codex-confirmed):** public share (`/share/[token]`) and the
export/diff routes call `loadArchivedSeoResult(sessionId)` — never `loadRunSeoResult` — so
they keep `archived: true` for genuinely pruned sessions. Export/share are already gated off
for run-only results by `ResultsView`'s `NeedsScreamingFrog` (no `sessionId`).

**Guard tests:** (1) `loadRunSeoResult` for a `source:'live-scan'` run → `archived: false`;
(2) `loadArchivedSeoResult` for a pruned session → `archived: true` (unchanged); (3)
`ResultsView` with `runId` (no `sessionId`) → no archived banner, **no completeness banner**,
live-scan note present; (4) `ResultsView` archived session → `ArchivedSessionBanner` unchanged.

## 6. Section maturation (structural ADA mirror, reuse)

Current `/seo-audits/page.tsx` is a narrow (`max-w-2xl`) stacked client page: header,
`SeoScanForm`, upload card, compare link, `HistoryList`. ADA's index is a wide
(`max-w-5xl`) hub: a "New Audit" card with Single/Site **tabs** (`AuditIndexTabs`) + recents.

**Changes (visual/structural only — no data/API/behavior change):**
- New client component `components/seo-parser/SeoAuditTabs.tsx` mirroring `AuditIndexTabs`:
  a "New SEO Audit" card whose header carries two tabs — **Scan a URL** (renders the existing
  `SeoScanForm`) and **Upload Screaming Frog CSVs** (renders the extracted upload flow).
  Default tab: **Scan a URL** (the matured primary action).
- Extract the current upload flow (drop/analyze/reset state in `page.tsx`) into
  `components/seo-parser/SeoUploadCard.tsx` (client) so the page shrinks to a thin wrapper.
  Behavior identical — same `/api/upload` batching, `/api/parse/[id]`, `missingCoreExports`
  gate, reset. The "Compare two crawls" link moves into the Upload tab footer (its natural
  home) or stays under the card.
- Page shell: header styled like the ADA index (`font-display` title + subtitle), container
  `max-w-5xl mx-auto px-6 py-10 space-y-8`, then `<SeoAuditTabs/>`, then `<HistoryList/>`
  (already merges live-scan + SF-upload with source badges — reused as-is).
- The shell `<main>` already supplies the page background; page root drops any `min-h-screen`
  / `bg-*` (A8 shell convention) and keeps padding + max-width only.

**Tab-state parity note:** unlike ADA (which derives the initial tab from `?auditTab=`),
`SeoScanForm` already consumes `?scan=` on mount. `SeoAuditTabs` must default to the Scan
tab so an inbound `?scan=` handoff lands on the visible form. No new URL param is introduced.

**Explicitly deferred:** an SSR recents server-component split, a separate queue page, and
results-page section blocks. The scan poller already lives in `SeoScanForm`; a separate
queue banner is unnecessary for v1.

## 7. Testing & gates

- **New/updated unit tests:** `next.config.test.ts` (redirects), `middleware.test.ts`
  (`/seo-audits` auth-gated), `SeoScanForm.test.tsx` (paths → `/seo-audits`), the live-scan
  banner behavior (fallback + `ResultsView` branch), `SeoAuditTabs` (tab switch renders the
  right panel; default = Scan), and the extracted `SeoUploadCard` (upload/analyze/reset).
- **Path-swap regression:** update the test files that assert `/seo-parser` link targets —
  `tools-registry.test.ts`, `Topbar.test.tsx`, widget tests (`RecentParsesWidget`,
  `QuickParserWidget`, `QuickSiteAuditWidget`), client-card/service tests (`ScheduledScansCard`,
  `Scorecard`, `FindingsPanel`, `ActivityTimeline`, `client-dashboard`, `client-findings`,
  `scorecard-shared`), `SiteAuditForm.test.tsx`, and the four behavioral seoOnly-link tests
  incl. **`app/(app)/ada-audit/site/[id]/seo-only-redirect.test.ts`** (expect `/seo-audits`).
  API-route tests under `app/api/seo-parser/**` stay unchanged (API path unchanged).
- **Gate-green (all three):** `npm run lint` (`tsc --noEmit`), `DATABASE_URL="file:./local-dev.db" npm test`,
  `npm run build`.
- **UI class rules:** `dark:` on every element; page roots follow the A8 shell convention
  (no own `min-h-screen`/`bg`); no hydration-mismatch patterns.

## 8. Prod verification (post-deploy, authed Playwright @ seo.erstaging.site)

1. Hit an **old** `/seo-parser` URL → confirm 308 → `/seo-audits` renders.
2. Hit an old deep link `/seo-parser/results/run/<id>` (or `/results/<sessionId>`) →
   confirm redirect to the `/seo-audits/...` equivalent and the page renders.
3. Confirm a shipped srt_-style share/handoff link still resolves.
4. Trigger a live SEO scan on the renamed surface for a **client** domain (or an
   `*.erstaging.site` domain we control) → confirm it runs and the result page reads as a
   first-class "Live SEO scan" (no "Archived" banner).
5. Confirm the tabbed New-SEO-Audit card renders (Scan default) and history lists prior runs.

## 9. Risks & rollback

- **Missed internal link** → mitigated by the permanent redirect (still resolves). Grep
  `rg "/seo-parser" app components lib` at end of build; only `/api/seo-parser`, `tool:`,
  and import paths should remain.
- **Redirect loop** → impossible: source `/seo-parser*` and destination `/seo-audits*` are
  disjoint prefixes; the destination folder is the only `/seo-audits` route.
- **`?scan=` handoff breakage** → covered: SiteAuditForm/QuickSiteAuditWidget push
  `/seo-audits?scan=`, `SeoScanForm` reads `?scan=` and `replaceState('/seo-audits')`.
- **Upload flow regression from extraction** → `SeoUploadCard` is a pure move of existing
  state/handlers; a unit test pins upload→analyze→reset behavior.
- **Rollback:** revert the PR; the redirect and folder move are atomic in one commit range.
  No migration, so no data risk.
