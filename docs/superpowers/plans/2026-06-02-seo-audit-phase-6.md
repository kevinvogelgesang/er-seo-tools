# SEO Audit Overhaul — Phase 6 Implementation Plan (Keyword Research route)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** A dedicated, linked **Keyword Research** workflow: upload SEMRush exports (Organic Positions/Pages + the new **Keyword Gap "Missing"** export) → a keyword-focused results view → a **keyword strategy memo** written by a Claude skill and rendered back in-app — reusing the proven mint-token/PATCH handoff (Phases 2/4) and the existing parse pipeline.

**Architecture:** Reuse the existing `/api/upload` + `/api/parse` pipeline (SEMRush CSVs already flow through the SEMRush parsers → `keyword_signals`). Phase 6 adds: (1) a **`SemrushKeywordGapParser`** feeding `keyword_signals.gap_keywords`; (2) a **`KeywordResearchSession`** model (linked to the underlying `Session`, optional `technicalSessionId`) that holds the memo — mirroring `SeoRoadmap`; (3) the keyword-memo handoff (token + 4 routes + payload builder) — a **direct mirror of the `seo-roadmap` feature**; (4) a `/keyword-research` route (upload → `/keyword-research/[sessionId]` keyword view + memo card); (5) the **`keyword-strategy-memo`** skill (out of repo). The memo is keyword strategy (target keywords, clusters, cannibalization fixes, content gaps from the gap export).

**Tech Stack:** Next.js 15 App Router, TS, Prisma + SQLite, `jose`, `react-markdown`, Vitest. Heavy reuse of `app/api/seo-roadmap/**`, `lib/seo-roadmap-token.ts`, `lib/seo-roadmap-prompt.ts`, `components/seo-parser/{GenerateRoadmapButton,SeoRoadmapCard,RoadmapMarkdown}.tsx`, `lib/memo-poller-machine.ts`.

**Spec:** `docs/superpowers/specs/2026-06-01-seo-audit-overhaul-design.md` (Phase 6 + D5). Stacked on `feat/seo-audit-phase-5`.

**Verify:** `npx tsc --noEmit` · `npx vitest run <path>` · `npm run build` · `npx prisma migrate dev --name <name>` (local-dev DATABASE_URL override as in prior phases).

---

## Design decisions (locked)

- **Reuse the existing upload+parse pipeline** — the `/keyword-research` upload posts to the SAME `/api/upload` + `/api/parse` (no new parser pipeline); SEMRush data already produces `keyword_signals`. The route just redirects to a keyword-focused results view instead of the technical one.
- **`KeywordResearchSession` mirrors `SeoRoadmap`**: `sessionId @unique` (the session whose keyword data it analyzes) + nullable `technicalSessionId` (auto-linked to the most recent *other* complete session for the same `clientId` at creation — "separate but linked" per Kevin) + `clientId?` + memo fields (status, memoMarkdown, structured?, tokenMintedAt, memoUpdatedAt).
- **Memo handoff is a verbatim mirror of `seo-roadmap`**: token prefix `krt_`, audience `keyword-strategy-memo`, scopes `['read','memo-write']`, secret `KEYWORD_MEMO_TOKEN_SECRET`; routes `POST /api/keyword-memo/by-session/[sessionId]/mint-token`, `GET /api/keyword-memo/[id]`, `PATCH /api/keyword-memo/[id]/memo`, `GET /api/keyword-memo/by-session/[sessionId]`.
- **Keyword Gap detection is header-based and disambiguated** from Organic Positions (Gap "Missing" is keyword-only: has `Keyword` + `Search Volume` + `Keyword Difficulty`, and **no `URL`** column). Flagged to validate against a real export.
- **`.txt` page-content ingestion is OUT OF SCOPE** (deferred) — Phase 6 is SEMRush-CSV-based keyword research, which reuses existing parsers.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `lib/parsers/semrush/semrushKeywordGap.parser.ts` (+ test); `lib/parsers/index.ts`; `lib/types/index.ts`; `lib/services/aggregator.service.ts` | Keyword Gap parser → `keyword_signals.gap_keywords` | 1 |
| `prisma/schema.prisma` + migration | `KeywordResearchSession` model | 2 |
| `lib/keyword-memo-token.ts` (+test); `lib/keyword-memo-prompt.ts` (+test); `lib/parsers/keyword-research-export.ts` (+test) | token + prompt + `buildKeywordResearchExport` | 3 |
| `app/api/keyword-memo/by-session/[sessionId]/mint-token/route.ts` + `app/api/keyword-memo/by-session/[sessionId]/route.ts` (+tests) | mint + poll | 4 |
| `app/api/keyword-memo/[id]/route.ts` + `app/api/keyword-memo/[id]/memo/route.ts` (+tests) | GET payload + PATCH write-back | 5 |
| `app/keyword-research/page.tsx`; `app/keyword-research/[sessionId]/page.tsx`; `components/keyword-research/*` | upload + keyword view + memo card/button | 6 |
| `~/.claude/skills/keyword-strategy-memo/` (out of repo) | the skill | 7 |

---

## Task 1: SEMRush Keyword Gap parser → `gap_keywords`

**Files:** Create `lib/parsers/semrush/semrushKeywordGap.parser.ts` + `.test.ts`; register in `lib/parsers/index.ts`; add types in `lib/types/index.ts`; wire in `lib/services/aggregator.service.ts`. READ an existing SEMRush parser (`lib/parsers/semrush/semrushOrganicPositions.parser.ts`) + its test for the `BaseParser` + `matchesContent` + `parse()` conventions.

- [ ] **Step 1: Types** in `lib/types/index.ts`:
```typescript
export interface GapKeyword {
  keyword: string;
  volume: number;
  difficulty?: number;
  intent?: string;
}
```
Add `gap_keywords?: GapKeyword[];` to the `KeywordSignals` interface.

- [ ] **Step 2: Parser** `semrushKeywordGap.parser.ts` — extend `BaseParser` like the sibling SEMRush parsers. `static matchesContent(headers)` (Codex-hardened detection — READ all three sibling parsers' `matchesContent` first):
  - **Required:** `Keyword` AND a volume alias (`Search Volume` OR `Volume`) AND a difficulty alias (`Keyword Difficulty` OR `Keyword Difficulty %` OR `KD` OR `KD %`).
  - **Must NOT include any of:** `URL`, `Landing Page`, `Page`, `Position`, `Previous position`, `Number of Keywords`, `Adwords Positions`, `Average Position`, `Avg. Position`, `Estimated Traffic`. (These disambiguate from Organic Positions [requires Keyword+Search Volume+Keyword Intents+URL], Organic Pages [requires Number of Keywords+Adwords Positions], and Position Tracking [raw-content/metadata detected].)
  - Optional parse: intent alias (`Intent` OR `Keyword Intent` OR `Keyword Intents`).
  `parse()` returns `{ gap_keywords: GapKeyword[], gap_keywords_count, total_gap_volume }` — map columns via the aliases, parse comma-numbers like the other SEMRush parsers. **TDD:** write `matchesContent` tests asserting TRUE for a Gap header row and FALSE for each of the Organic Positions, Organic Pages, and Position Tracking header sets (copy their expected headers from the sibling tests); assert `parse()` extracts keywords + volumes. **Code comment:** flag that real SEMRush "Keyword Gap → Missing" headers (often `Volume`/`KD %`) must be validated against an actual export.

- [ ] **Step 3: Register** in `lib/parsers/index.ts` `PARSERS` array — place it with the other SEMRush content-detected parsers (after filename-based parsers; near the other `semrush*` entries). Confirm ordering doesn't let Organic Positions swallow a Gap file or vice-versa (the URL-absent check handles it; add a routing assertion to the test if the index has a routing test).

- [ ] **Step 4: Aggregator** — in `computeKeywordSignals()` (`aggregator.service.ts`), read the keyword-gap parser output (`this.parsedData.semrushkeywordgap`) and include `gap_keywords` in the returned `KeywordSignals`. Mirror how it reads `semrushorganicpositions`/`semrushorganicpages`; default `[]` when absent. **IMPORTANT (Codex fix #2):** the method currently early-returns `{}` when neither Organic Positions nor Organic Pages is present (~aggregator.service.ts:825). Add `gapData` (the keyword-gap output) to that condition so a **gap-only upload still produces `keyword_signals` with `gap_keywords`** (and `semrush_connected: true`).

- [ ] **Step 5:** `npx vitest run lib/parsers lib/services/aggregator` + `npx tsc --noEmit` → PASS.

- [ ] **Step 6: Commit**
```bash
git add lib/parsers/semrush/semrushKeywordGap.parser.ts lib/parsers/semrush/semrushKeywordGap.parser.test.ts lib/parsers/index.ts lib/types/index.ts lib/services/aggregator.service.ts
git commit -m "feat(seo): SEMRush Keyword Gap parser → keyword_signals.gap_keywords"
```
(End each commit body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.)

---

## Task 2: `KeywordResearchSession` model + migration

**Files:** `prisma/schema.prisma` + migration. Mirror the `SeoRoadmap` model (read it).

- [ ] **Step 1: Model:**
```prisma
model KeywordResearchSession {
  id                 String   @id @default(cuid())
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  sessionId          String   @unique
  session            Session  @relation("KeywordResearchForSession", fields: [sessionId], references: [id], onDelete: Cascade)
  clientId           Int?
  technicalSessionId String?  // optional link to the related technical-audit Session (same client/run)
  status             String   @default("pending") // pending | processing | complete | error
  error              String?
  tokenMintedAt      DateTime?
  memoMarkdown       String?
  structured         String?  // JSON (optional)
  memoUpdatedAt      DateTime?

  @@index([sessionId, status])
  @@index([clientId])
  @@index([createdAt])
}
```
Add the inverse relation to `Session`: `keywordResearch  KeywordResearchSession? @relation("KeywordResearchForSession")` (named relation; Codex confirmed no clash with `seoRoadmap`/`pages`/`pillarAnalyses`/`shareLinks`).

**Also add a `workflow` marker to `Session`** (Codex fix #3 — keyword uploads reuse `/api/parse` and would otherwise pollute parse history + Phase 5 client trends + trigger pillar analysis):
```prisma
  workflow        String   @default("technical") // 'technical' | 'keyword-research'

  @@index([workflow])
```
This one migration adds BOTH the `KeywordResearchSession` table and the `Session.workflow` column (additive, defaulted — old rows become `'technical'`).

- [ ] **Step 2: Migrate** `npx prisma migrate dev --name keyword_research_session` (local-dev DATABASE_URL override). Verify the table + unique index on `sessionId`. `npx tsc --noEmit`.

- [ ] **Step 3: Commit**
```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(seo): KeywordResearchSession model + migration"
```

---

## Task 3: keyword-memo token + prompt + export builder

**Files:** `lib/keyword-memo-token.ts` (+test), `lib/keyword-memo-prompt.ts` (+test), `lib/parsers/keyword-research-export.ts` (+test). Mirror `lib/seo-roadmap-token.ts`, `lib/seo-roadmap-prompt.ts`, and `lib/parsers/claude-export-builder.ts` respectively (read them).

- [ ] **Step 1: Token** `lib/keyword-memo-token.ts` — copy `seo-roadmap-token.ts` with: `AUDIENCE='keyword-strategy-memo'`, `TOKEN_PREFIX='krt_'`, secret `KEYWORD_MEMO_TOKEN_SECRET`, dev fallback `'dev-keyword-memo-secret-do-not-use-in-prod'`, scopes `['read','memo-write']`, class `KeywordMemoTokenError`, fns `mintKeywordMemoToken(id)`/`verifyKeywordMemoToken(token, expectedId)`. Mirror the test (`lib/seo-roadmap-token.test.ts`) → `lib/keyword-memo-token.test.ts`.

- [ ] **Step 2: Prompt** `lib/keyword-memo-prompt.ts` — `composeKeywordMemoPayload({ webappUrl, memoId, token })` → lines `Generate a keyword strategy memo for this site.` / `Webapp:` / `Memo ID:` / `Access token:` / `(Expires in 1h)` / instruction. Mirror `seo-roadmap-prompt.ts` + test.

- [ ] **Step 3: Export builder** `lib/parsers/keyword-research-export.ts` — `buildKeywordResearchExport(result: AggregatedResult): KeywordResearchExport` returning a keyword-focused payload: `{ site_name, crawl_summary (slim: total_urls, indexable), keyword_signals (the full KeywordSignals incl. gap_keywords), duplicate_content? (titles only — useful for cannibalization context) }`. Keep it browser-safe (type-only imports). Define the `KeywordResearchExport` interface. Test: a `mockResult` with `keyword_signals` (incl. `gap_keywords`) → assert the export carries `keyword_signals.gap_keywords` and omits the heavy technical sections (issues/resources/technical_seo).

- [ ] **Step 4:** `npx vitest run lib` + `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/keyword-memo-token.ts lib/keyword-memo-token.test.ts lib/keyword-memo-prompt.ts lib/keyword-memo-prompt.test.ts lib/parsers/keyword-research-export.ts lib/parsers/keyword-research-export.test.ts
git commit -m "feat(seo): keyword-memo token + prompt + research export builder"
```

---

## Task 4: Mint-token + by-session poll routes

**Files:** `app/api/keyword-memo/by-session/[sessionId]/mint-token/route.ts` (+test) and `app/api/keyword-memo/by-session/[sessionId]/route.ts` (+test). **Mirror the seo-roadmap equivalents EXACTLY** (`app/api/seo-roadmap/by-session/[sessionId]/mint-token/route.ts` and `.../by-session/[sessionId]/route.ts`), swapping: `prisma.seoRoadmap`→`prisma.keywordResearchSession`, `mintSeoRoadmapToken`→`mintKeywordMemoToken`, `SeoRoadmapTokenError`→`KeywordMemoTokenError`, response key `roadmapId`→`memoId`, `seoRoadmap`→`keywordResearch` in the poll response, field `roadmapMarkdown`→`memoMarkdown`/`roadmapUpdatedAt`→`memoUpdatedAt`.

- [ ] **Step 1: Mint route** — same get-or-create-as-pending → mint → flip to processing (error on mint failure), P2002-only race catch, `session.status === 'complete'` gate. At row creation, **set `clientId: session.clientId`** (Codex fix #4) and **auto-link `technicalSessionId`** (Codex fix #5) = the most recent session matching: same `clientId` (only if non-null), `status:'complete'`, `id != current`, `workflow: 'technical'`, and `keywordResearch: null` (no keyword row) — else null. Return `{ token, expiresAt, memoId }`.
- [ ] **Step 2: Poll route** — returns `{ keywordResearch: { id, sessionId, status, error, memoMarkdown, memoUpdatedAt, createdAt, updatedAt } | null }`.
- [ ] **Step 3: Tests** — mirror the seo-roadmap mint + by-session tests (real auth cookie via `createAuthCookieValue` for mint; the create/regenerate/race/mint-failure cases; the null + shaped cases for poll). Add one assertion that `technicalSessionId` is set when a prior complete session for the same client exists.
- [ ] **Step 4:** `npx vitest run "app/api/keyword-memo"` + `npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit**
```bash
git add "app/api/keyword-memo/by-session"
git commit -m "feat(seo): keyword-memo mint-token + by-session poll routes"
```

---

## Task 5: GET payload + PATCH write-back routes

**Files:** `app/api/keyword-memo/[id]/route.ts` (+test), `app/api/keyword-memo/[id]/memo/route.ts` (+test). **Mirror `app/api/seo-roadmap/[id]/route.ts` and `.../[id]/roadmap/route.ts` EXACTLY**, swapping token/model/field names and using `buildKeywordResearchExport` instead of `buildTechnicalAuditExport`.

- [ ] **Step 1: GET payload** `app/api/keyword-memo/[id]/route.ts` — Bearer `krt_` + `read` scope + sub===id; load `keywordResearchSession` incl. `session`; parse `session.result`; return `{ id, sessionId, technicalSessionId, siteName, status, keyword: buildKeywordResearchExport(result) }` (include `technicalSessionId` so the skill can disclose linked technical context — Codex fix #6). (No `teamwork` block — keyword memo doesn't push tasks.)
- [ ] **Step 2: PATCH** `app/api/keyword-memo/[id]/memo/route.ts` — Bearer `memo-write` scope; body `{ memo: string, structured? }`; 50k cap on `memo`, 200k cap + object guard on `structured`; write `memoMarkdown` (+structured) + `status:'complete'` + `error:null` + `memoUpdatedAt`. Validate body before auth (mirror).
- [ ] **Step 3: Tests** — mirror the seo-roadmap GET + PATCH route tests (auth/scope/token cases; 200 returns `keyword` payload with `keyword_signals`; PATCH writes memo + complete; caps; hand-minted scopeless token for the scope case).
- [ ] **Step 4:** `npx vitest run "app/api/keyword-memo"` + `npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit**
```bash
git add "app/api/keyword-memo/[id]"
git commit -m "feat(seo): keyword-memo GET payload + PATCH write-back routes"
```

---

## Task 6: `/keyword-research` route (upload + keyword view + memo)

**Files:** `app/keyword-research/page.tsx`; `app/keyword-research/[sessionId]/page.tsx`; `components/keyword-research/{GenerateKeywordMemoButton,KeywordMemoCard}.tsx`. Reuse `components/seo-parser/FileDropzone.tsx`, `KeywordSignalsPanel.tsx`, `RoadmapMarkdown.tsx` (or a copy), `lib/memo-poller-machine.ts`, `lib/keyword-memo-prompt.ts`.

- [ ] **Step 0: Mark keyword uploads with `workflow` + keep them out of the technical surfaces.**
  - `/api/upload`: accept an optional `workflow` form field and store it on the created `Session` (default `'technical'`). The keyword-research upload page sends `workflow=keyword-research`.
  - `/api/parse/[sessionId]`: when the session's `workflow === 'keyword-research'`, **skip `triggerPillarAnalysis`** (it's a technical-only side effect). Everything else (parsers, SessionPage persistence, scalars) runs as normal.
  - **Phase 5 contamination fix:** in `lib/services/client-seo-history.ts` `getClientSeoHistory`, add `workflow: 'technical'` to the `where` so keyword-research sessions don't appear in the client SEO trend/history. (Update its test accordingly.)

- [ ] **Step 1: Upload page** `app/keyword-research/page.tsx` — mirror `app/seo-parser/page.tsx`'s upload flow (FileDropzone → `/api/upload` with `workflow=keyword-research` in the form data → `/api/parse/[sessionId]`), but: (a) hint SEMRush exports (Organic Positions/Pages + Keyword Gap "Missing") in the copy, (b) on completion `router.push('/keyword-research/' + sessionId)`. Reuse the existing components; mostly a copy of the seo-parser upload page with different copy + redirect + the workflow flag.
- [ ] **Step 2: `GenerateKeywordMemoButton.tsx`** — mirror `components/seo-parser/GenerateRoadmapButton.tsx`: POST `/api/keyword-memo/by-session/${sessionId}/mint-token`, compose via `composeKeywordMemoPayload`, copy to clipboard, `emitMemoPollerTrigger()`. Label "Generate Keyword Memo" / "Regenerate Keyword Memo".
- [ ] **Step 3: `KeywordMemoCard.tsx`** — mirror `components/seo-parser/SeoRoadmapCard.tsx` (copy its poller wiring via `createPollingMachine`, auto-start only when `initialStatus==='processing'`): props `{ sessionId, initialStatus, initialMemoMarkdown, initialMemoUpdatedAt }`; polls `/api/keyword-memo/by-session/${sessionId}`, reads `keywordResearch.memoUpdatedAt`, `router.refresh()` on change; renders the memo markdown (reuse `RoadmapMarkdown` or a `KeywordMemoMarkdown` copy) or empty state; includes `GenerateKeywordMemoButton`.
- [ ] **Step 4: Results page** `app/keyword-research/[sessionId]/page.tsx` (server) — load the session (`prisma.session.findUnique`), parse `result`; if no `keyword_signals` show a "no SEMRush keyword data in this upload" notice. Load the `keywordResearchSession` row for `initialStatus`/memo. Render: a header, the existing `<KeywordSignalsPanel data={result.keyword_signals} />` (+ a small gap-keywords list if `gap_keywords` present), and `<KeywordMemoCard ... />`. `notFound()` if session missing.

- [ ] **Step 4b: Update `KeywordSignalsPanel` typing** (Codex fix #7) — the component defines its own local `KeywordSignals` interface WITHOUT `gap_keywords`. Add `gap_keywords?: GapKeyword[]` to that local type (or import the shared type from `@/lib/types`) and render a compact gap-keywords list/table (keyword · volume · difficulty · intent) when present. Keep it null-safe for sessions without gap data.
- [ ] **Step 5:** `npx tsc --noEmit && npm run build` → PASS.
- [ ] **Step 6: Commit**
```bash
git add app/keyword-research components/keyword-research
git commit -m "feat(seo): /keyword-research route (upload + keyword view + memo handoff)"
```

---

## Task 7: `keyword-strategy-memo` Claude skill (out of repo)

**Files:** `~/.claude/skills/keyword-strategy-memo/` (SKILL.md, README.md, version.txt, scripts/). NOT in the repo PR. Mirror `~/.claude/skills/seo-audit-roadmap/`.

- [ ] **Step 1:** Read `~/.claude/skills/seo-audit-roadmap/SKILL.md`. Create a parallel skill that:
  - Activates on a clipboard payload with `Webapp:`, `Memo ID:`, and `Access token: krt_...`.
  - `GET {webappUrl}/api/keyword-memo/{memoId}` (Bearer) → `{ siteName, keyword: KeywordResearchExport }` (keyword_signals incl. cannibalization, quick_wins, optimization_gaps, top_pages_by_organic_traffic, gap_keywords).
  - Writes a **keyword strategy memo** (markdown): target-keyword priorities, topic clusters, cannibalization fixes (one URL per keyword), quick wins (positions 11–20), and **content opportunities from `gap_keywords`** (what to create). Honest about data presence.
  - `PATCH {webappUrl}/api/keyword-memo/{memoId}/memo` with `{ "memo": "<markdown>" }`.
  - Re-PATCH on in-chat revision. Reply with summary + `{webappUrl}/keyword-research/{sessionId}`.
- [ ] **Step 2:** README + version.txt. No repo tests; verified in the exit checklist. Note in the PR that the skill is out of repo.

---

## Phase 6 Exit Verification
- [ ] `npx tsc --noEmit` clean; `npx vitest run lib app/api/keyword-memo lib/parsers` green; `npm run build` succeeds; migration applies.
- [ ] Uploading SEMRush exports at `/keyword-research` produces a keyword view; a Keyword Gap "Missing" export populates `gap_keywords`.
- [ ] "Generate Keyword Memo" mints a `krt_` token + copies the prompt; the `keyword-strategy-memo` skill GETs the payload, writes the memo, PATCHes back; the memo card polls + renders it; re-run reads "Regenerate".
- [ ] `KeywordResearchSession.technicalSessionId` auto-links to the most recent other complete session for the same client (when one exists).
- [ ] Token negative cases (expired/wrong-id/wrong-scope) return 401.
- [ ] `KEYWORD_MEMO_TOKEN_SECRET` documented for production (alongside PILLAR_/SEO_ROADMAP_ secrets).

## Out of scope (later)
- `.txt` page-content ingestion (SF bulk export) for deeper content-gap analysis.
- Pushing keyword tasks to Teamwork (the roadmap path covers technical tasks; keyword is memo-only for now).

## Notes / risk
- **Keyword Gap header detection is a best guess** — validate `matchesContent` against a real SEMRush "Keyword Gap → Missing" export and adjust required headers; the URL-absent check is the key disambiguator from Organic Positions.
- **Heavy mirror of seo-roadmap** — keep the token/route/skill structure identical to reduce bugs; only names + the payload builder differ. No new auth/handoff invention.
- **`KEYWORD_MEMO_TOKEN_SECRET`** must be set in production (same as the other token secrets).
- Reusing `/api/upload`+`/api/parse` means a keyword session is a normal `Session` (it also runs the technical parsers harmlessly), now tagged `workflow:'keyword-research'` so it skips pillar analysis and is excluded from Phase 5 client trends; the keyword view focuses on `keyword_signals`.
- **Gap-only uploads** (Keyword Gap "Missing" alone) have no URL column → likely no `siteName`/`clientId` → no client auto-link and no `technicalSessionId`. For client association + linking, upload Organic Positions alongside the Gap export. An explicit client picker on the keyword upload page is a possible follow-up (out of scope now).
