# Pillar Analysis — Design Spec

**Date:** 2026-04-28
**Owner:** Kevin Vogelgesang
**Status:** Draft for review
**Target repo:** `kevinvogelgesang/er-seo-tools`

---

## 1. Goal

Internal tool for Enrollment Resources analysts. Given a Screaming Frog crawl of a higher-ed/career-college client site (already imported into the er-seo-tools `/seo-parser` flow, optionally with GSC, GA4, and Semrush data), produce three answers:

1. A 1–10 score for how worthwhile a pillar-page model would be on this site.
2. The recommended hub format: nest under existing program pages, or build a `/resources/` or `/career-guides/` hub.
3. A per-URL verdict for every blog/news/resource post: become a pillar, become a cluster page, leave as a blog post, consolidate into another page, or prune.

Internal-only. The client never sees the output. Voice is direct and pragmatic — accuracy matters more than diplomacy.

## 2. Non-goals

- Producing client-facing deliverables (memos, decks, reports). The team can derive those manually from the internal output.
- Generating new content. The tool recommends *what* to do, not *what to write*.
- Real-time crawling. Input is always an existing Screaming Frog export already loaded into the `/seo-parser` flow.
- Calling external AI/embedding APIs from the webapp. All LLM reasoning happens inside the user's Claude session via the skill.
- Public sharing. No share tokens, no public dashboard view.

## 3. System architecture

Three layers across two repos:

**er-seo-tools (Next.js webapp, RunCloud-deployed)** does all deterministic work:

- New parsers in `lib/parsers/`: GSC + GA4 per-URL joins (currently only summarized in TS side), extending existing `semrush/` for per-URL backlink and ranking-keyword counts.
- New service `lib/services/pillarAnalysis.service.ts` performs: per-URL join across all parsers on `Address`; page-type classification; local-embedding topic clustering (via Transformers.js + `Xenova/all-MiniLM-L6-v2`); site fit score; hub-format decision; per-URL verdicts.
- New Prisma model `PillarAnalysis` stores: `seoParserCrawlId` (FK), `score`, `subscores` (JSON), `hubRecommendation` (JSON with alternates), `pillarTopics` (JSON), `urlVerdicts` (JSON), `dataCompleteness` (0–1), `aiNarrative` (text, nullable, populated later by skill), `narrativeUpdatedAt` (DateTime, nullable), `runnerVersion`, timestamps.
- New config module `lib/services/pillarAnalysis.config.ts` holds tunable thresholds and weights (`clusterSimilarityThreshold`, `nearDuplicateThreshold`, `verticalAlignmentThreshold`, all six subscore weights). Per-client overrides stored as JSON on the existing `Client` Prisma model — no redeploy needed to tune.
- New dependency `@xenova/transformers` (npm, MIT, ONNX-runtime under the hood — pure JS in Node). Lazy-loaded inside `pillarAnalysis.service.ts` only; no other code path imports it. `postinstall` deploy hook pre-warms the model cache (~25MB on disk) so first analysis after deploy doesn't pay the download.
- New route `/pillar-analysis/[id]`: internal dashboard. Sticks with existing dark-mode/Tailwind/Recharts conventions. Sections: site score with subscore breakdown, hub recommendation, expandable pillar topic groupings (each showing its cluster pages), full URL verdict table (sortable/filterable), narrative slot at top.
- API endpoints: `POST /api/pillar-analysis` (creates record, runs deterministic analysis, returns id), `GET /api/pillar-analysis/[id]` (full JSON, JWT-authed), `PATCH /api/pillar-analysis/[id]/narrative` (skill writes narrative back, JWT-authed), `POST /api/pillar-analysis/[id]/mint-token` (mints a 1-hour single-purpose JWT for the clipboard payload).
- Pipeline hook: when a seo-parser report finishes parsing, automatically queue the deterministic pillar analysis. Reuse the existing site-audit queue pattern.
- UI on `/seo-parser/results/[id]`: a "Copy Claude Prompt" button that calls `mint-token` and copies the formatted clipboard payload via the browser Clipboard API.

**Claude Code skill / Claude Desktop skill** does narrative work:

- Activates when the user pastes a clipboard payload containing `Analysis ID:` and a `pat_*` access token.
- Parses webapp URL + analysis ID + token from the user message.
- Calls `GET /api/pillar-analysis/[id]` to fetch the structured JSON.
- Generates a strategic memo following the template structure (six fixed sections).
- Calls `PATCH /api/pillar-analysis/[id]/narrative` to post the memo back.
- Replies in chat with a one-screen summary plus the dashboard URL.

**Anthropic billing constraint respected:** all LLM calls happen in the user's Claude session. The webapp only stores text the skill writes.

## 4. Data layer — per-URL records

Canonical record schema (TypeScript):

```ts
type UrlRecord = {
  url: string;
  pageType: 'program' | 'blog' | 'news' | 'resource' | 'nav' | 'home' | 'unknown';
  pageTypeConfidence: number;        // 0–1

  // From internal_all.csv (always present)
  title: string | null;
  h1: string | null;
  wordCount: number | null;
  crawlDepth: number | null;
  inlinks: number | null;            // unique inbound internal
  outlinks: number | null;
  indexable: boolean;

  // From GSC export (optional)
  gscClicks: number | null;
  gscImpressions: number | null;
  gscCtr: number | null;
  gscPosition: number | null;

  // From GA4 export (optional)
  ga4Sessions: number | null;
  ga4EngagementRate: number | null;
  ga4KeyEvents: number | null;

  // From Semrush export (optional, parser already exists)
  referringDomains: number | null;
  organicKeywords: number | null;

  // Computed
  intentClass: 'informational' | 'commercial' | 'transactional' | 'navigational' | 'unknown';
  topicClusterId: number | null;
  verdict: 'pillar' | 'cluster' | 'leave-as-blog' | 'consolidate' | 'prune' | 'unclear';
  verdictConfidence: number;
  recommendedPillar: string | null;  // populated when verdict ∈ {pillar, cluster}
  reasoning: string[];               // structured bullets feeding the verdict
};
```

Stored as JSON column `urlVerdicts` on the `PillarAnalysis` row. Embedding vectors computed during clustering and discarded — only `topicClusterId` persists.

## 5. Page-type classification

Hierarchical signal precedence (URL slugs are the ground truth on higher-ed sites; structured data is too unreliable to be peer-weighted):

1. **Primary — URL slug regex.** If the slug clearly matches a default rule, that's the answer. Defaults: `/programs?/` → program, `/blog/|/news/` → blog, `/resources?/|/career-guides?/|/guides/` → resource, `/about/|/contact/|/team/|/staff/` → nav. Confidence ≥0.85 when slug matches.
2. **Secondary tiebreaker — schema.org type.** Used only when the URL slug is ambiguous (no rule matches, or the slug matches multiple rules). `Course`/`EducationalOccupationalProgram` → program; `Article`/`BlogPosting`/`NewsArticle` → blog/news. Confidence 0.6–0.75.
3. **Tertiary tiebreaker — crawl depth.** Depth 1–2 → nav/program/home bias; depth 3+ → content bias. Used only when both slug and schema are silent. Confidence ≤0.5.

Confidence below 0.7 flags the URL for human review. **Per-client override table** stored as JSON on the existing `Client` Prisma model — small UI on `/pillar-analysis/[id]` lets the analyst remap URL prefixes before re-running. (Override UI ships in Phase 3; for Phase 1 the override is editable directly on the client record.)

## 6. Topic clustering — local embeddings via Transformers.js

Build a 384-dim embedding vector per URL using `Xenova/all-MiniLM-L6-v2` running locally in the Node process. Source text per URL: `title + " " + H1 + " " + metaDescription + " " + firstParagraphCustomExtraction` (trimmed, deduped). No outbound API calls — the model runs in-process via ONNX runtime.

- Model file ~25MB on disk, ~150MB resident in RAM after load. Lazy-loaded on first pillar-analysis run; cached for the process lifetime.
- Pre-warmed during `postinstall` so the first real analysis after a deploy doesn't pay the download.
- Cosine similarity → complete-linkage agglomerative clustering. Cut at similarity threshold **0.55** (tunable via config; calibrated for MiniLM, where same-topic content typically scores 0.55–0.85).
- Near-duplicate threshold for the `consolidate` verdict: **0.85** cosine.
- Cluster-to-program "vertical alignment" threshold (used in §9): **0.55** cosine.

**Why MiniLM specifically:** smallest mainstream model that produces clearly-better-than-lexical clusters; ONNX-friendly; fully bundled in `@xenova/transformers`'s default install. Larger models (e5-small, bge-small) score modestly higher on MTEB but double the RAM and cold-start time — not worth it for our use case.

**SF custom extraction is still helpful but no longer critical.** With semantic embeddings, title + H1 + meta description give acceptable clustering even without first-paragraph extraction. We still recommend the SF setup (ships in `templates/screaming-frog-setup.md`) for higher-quality clusters but it's not a hard requirement.

## 7. Intent classification — pure rules

- **Informational:** regex on title/H1 for `how to`, `what is`, `guide`, `tips`, `vs`, `examples`, trailing `?`.
- **Commercial:** `best`, `top`, `review`, `cost of`, `pricing`.
- **Transactional:** program-page slug + presence of `apply`, `enroll`, `register`, or schema.org `Course`/`EducationalOccupationalProgram`.
- **Navigational:** low word count + URL in nav slug regex.
- **Default by pageType:** blog/news/resource → informational; program → transactional; nav → navigational.

Confidence computed from rules-fired vs. rules-conflicting. Below 0.5 → `unknown` (skill can flag for analyst).

## 8. Site fit score (1–10) — higher-ed-tuned weights

Six subscores, each 0–10, weighted sum, rounded:

| Subscore | Weight | What it measures |
|---|---|---|
| Informational content volume | 25% | Count of informational pages. Threshold curve: 0 at <15, 10 at >100. |
| Topical concentration | 20% | # of embedding clusters of size ≥3. Continuous curve: 0 at 0 clusters, peaks at 10 for 5–8 clusters, decays linearly to 5 at 14+ clusters (over-fragmentation penalty). |
| Existing organic footprint | 20% | Σ GSC impressions on non-brand queries to informational pages. Log-scaled. |
| Internal-link gap | 15% | Inverse of avg cross-cluster internal-link density. High gap = high opportunity. |
| Program-page clarity | 15% | Mean commercial-intent confidence on program pages. (+5% from baseline; higher-ed-specific.) |
| Backlink distribution | 5% | Variance in referring-domain count across blog posts. (–5% from baseline; career-college sites rarely have rich backlinks.) |

**Missing-data handling:** missing subscores default to 5 ("neutral"). `dataCompleteness: 0.0–1.0` (fraction of subscores with real data) tags the score for low-confidence display.

**`dataCompleteness` UI rules — non-negotiable:**

- The score number is **never displayed without** the `dataCompleteness` value adjacent (e.g. "7/10 — 100% data" or "6/10 — 50% data, low confidence").
- When `dataCompleteness < 0.5`, the dashboard renders a banner above the score: *"Low-confidence score: {N}% of signals are missing (no GSC export, no Semrush, etc.). Treat as directional only."* Banner is not dismissible.
- The skill's chat-reply summary (§11.5) must surface `dataCompleteness` whenever it's below 1.0, so the analyst doesn't blindly cite a middle-of-the-road "5" that's actually a ghost-town artifact of missing data.

**Profiles:**
- 3 = "fix program pages first, pillar model premature."
- 7 = "classic retrofit opportunity, real upside."
- 9 = "topical authority already latent, pillar model captures it."

## 9. Hub-format decision tree

For each cluster, compute closest program-page embedding cosine match. Cluster is "vertical" (program-aligned) if best match ≥`verticalAlignmentThreshold` (default 0.55, MiniLM-calibrated), else "horizontal."

1. ≥80% clusters vertical AND program pages already pull informational GSC impressions → **nest under program pages**.
2. ~50/50 split → **hybrid** (vertical clusters nest under programs; horizontal go to `/resources/` hub).
3. Mostly horizontal AND existing `/blog/` has backlink authority worth preserving → **rename `/blog/` → `/resources/`** (preserves URL equity via 301s).
4. Topic clusters lean toward "X career," "salary for X," "how to become X" patterns (detectable via title + H1 keyword presence) → **fresh `/career-guides/` hub**.
5. None of the above → fallback to **`/resources/`** with low confidence flag.

Output includes top-2 alternates with score deltas, so the analyst sees how close the call was.

## 10. Per-URL verdict rules

Five buckets plus `unclear`:

- **pillar** — anchor of a cluster of ≥3 informational pages, has highest **authority composite rank** in the cluster. For each of the three signals — `inlinks`, `gscClicks`, `referringDomains` — rank pages within the cluster (1 = highest, ties share rank). Authority composite = sum of inverse ranks across present signals (missing signals contribute 0). Highest composite wins. Tiebreak: highest `wordCount`. Rank-based scoring is robust to tiny sample sizes (n=3 clusters) where z-scores would be statistically meaningless.
- **cluster** — informational, member of a cluster of ≥3, not the pillar.
- **leave-as-blog** — informational but lonely (cluster size <3 with no near-duplicate), or already has standalone authority (backlinks > threshold or significant GSC clicks).
- **consolidate** — thin/duplicate of another post (near-duplicate cosine ≥0.85 on MiniLM embeddings OR same cluster + word count <500 + low traffic). Names the merge target.
- **prune** — word count <100 OR (zero traffic AND zero backlinks AND no recent updates). Recommend noindex or 410.
- **unclear** — confidence below 0.5; falls to skill narrative for resolution.

Edge cases:
- Long high-authority post in a small cluster: still a `pillar` candidate even with cluster size <3.
- Commercial-intent post in a cluster: → `leave-as-blog` (won't fit cluster model regardless).

## 11. Skill design

### 11.1 Identity

Name: `pillar-analysis-narrative`. Distribution: ZIP via Customize → Skills (Claude Desktop / claude.ai web); filesystem under `~/.claude/skills/` (Claude Code).

Description (used by model for invocation):

> Use this when the user pastes a clipboard payload from the er-seo-tools dashboard containing an "Analysis ID:" and a "pat_" access token. Fetches the structured pillar analysis from the internal webapp, writes a strategic narrative memo, posts it back to the dashboard, and returns a summary. Internal use only.

### 11.2 Folder structure

```
pillar-analysis-narrative/
├── SKILL.md
├── scripts/
│   ├── fetch_analysis.py
│   └── post_narrative.py
├── templates/
│   ├── memo_structure.md
│   └── screaming-frog-setup.md
└── README.md
```

### 11.3 Execution flow (encoded in SKILL.md)

1. Parse `Webapp:`, `Analysis ID:`, `Access token: pat_*` from user message. Validate token shape (`pat_[A-Za-z0-9_-]+`) before sending. If any missing or malformed → ask user to re-copy from the dashboard.
2. Run `scripts/fetch_analysis.py` → returns structured JSON.
3. Read `templates/memo_structure.md` for section schema and few-shot examples.
4. Generate the memo section-by-section, reading from the JSON.
5. Run `scripts/post_narrative.py` to PATCH back. On 401 → distinguish error type (expired vs. malformed vs. wrong-analysis-id) and surface that to the user. Other errors → still print summary, flag dashboard not updated.
6. Reply with one-screen summary + dashboard URL.

**Narrative-staleness rule (hard requirement):** if the user asks the model to revise the memo within the same conversation ("tweak the migration sequence," "make the bottom line harsher," etc.), the model MUST re-run `scripts/post_narrative.py` with the revised text. The dashboard is the source of truth — silent edits in chat that don't get PATCHed back leave the dashboard with a stale first draft. SKILL.md states this as a non-negotiable rule with a worked example.

### 11.4 Memo structure (six fixed sections, ~600–1000 words total)

1. **Bottom line** — 1–3 sentences. "Worth it" / "Worth it but later" / "Don't bother — fix X first."
2. **Score interpretation** — 1 paragraph. Names the weakest subscore explicitly.
3. **Hub recommendation** — 2 paragraphs. Picked format with reasoning + runner-up.
4. **Pillar topics** — one short block per cluster: cluster name (model picks from cluster's top-frequency terms), anchor URL, cluster-page count, topical strength, one risk.
5. **Migration sequencing** — 1 paragraph + ordered list. What to do first, second, third.
6. **Caveats** — bulleted list. Missing data, low-confidence verdicts, sample-size warnings.

### 11.5 Chat reply format

Short, scannable. Full memo lives in the dashboard. When `dataCompleteness < 1.0`, the score line MUST include the completeness flag — the analyst should never see a score without knowing how complete the inputs were.

```
✓ Pillar analysis narrative posted for {site}

Score: {N}/10 — {one-line interpretation}{ — ⚠ {dataCompleteness}% data completeness when <100%}
Hub recommendation: {format} (alternate: {format}, {close call | clear winner})
Pillar topics: {N} clusters identified ({M} cluster pages, {K} leave-as-blog, {P} prune)
Narrative updated: just now

Dashboard: {url}
```

### 11.6 Error handling

The webapp's JWT validator returns distinct error codes (not just 401) so the skill can give actionable guidance:

- `token_expired` → "Token expired (1h limit). Refresh er-seo-tools and click Copy Claude Prompt again."
- `token_malformed` → "Token didn't parse — your clipboard manager may have truncated it. Try copying again, and avoid pasting into intermediate apps."
- `token_invalid_signature` → "Token signature invalid. This usually means the webapp was redeployed and old tokens are no longer valid — copy a fresh one."
- `token_wrong_analysis_id` → "Token doesn't match this analysis ID. Did you mix up two clipboard payloads?"
- 404 → "Analysis not found — was it deleted, or is the ID typo'd?"
- Connection error → "Couldn't reach webapp. Check VPN if remote."
- PATCH fails after fetch → still print summary; flag dashboard not updated; offer retry.
- Sandbox-blocked domain → "Webapp must be reachable from Claude's code-execution sandbox — needs public DNS."

## 12. Authentication

Each analysis has a `mint-token` endpoint that issues a JWT scoped to read + narrative-write on that specific analysis ID, expiring after 1 hour. Token is embedded in the clipboard payload at copy-time. Skill extracts and uses for the API calls. No persistent credential anywhere — each clipboard payload is single-purpose and short-lived.

## 13. Risks and open questions

1. **Embedding model RAM and cold start.** MiniLM resident size ~150MB; first-load adds ~2–3s to the first analysis after a PM2 restart. RunCloud VPS should handle it given the existing browser-pool footprint, but a `top` check after the first deploy is in the rollout plan. If memory pressure becomes an issue, the model can be unloaded after each analysis at the cost of paying the cold start every run.
2. **Webapp must be publicly reachable** from Claude's code-execution sandbox. Currently true (`144.126.213.242`). Any future move to internal-only networking breaks the skill.
3. **Windows parity for Claude Desktop skills.** Confirmed Skills work in Claude Desktop generally (ZIP upload via Customize), but feature parity on Windows specifically should be smoke-tested before rollout.
4. **Higher-ed-tuned weights are opinionated.** May need re-tuning after first 5–10 real client analyses. Subscore weights surfaced in JSON config (not hardcoded) so adjustment doesn't require a deploy.
5. **Page-type classification on weird IA.** URL-slug heuristics break on clients with unconventional structures (e.g., everything under `/`). Override table is the escape hatch, but adds a manual step that defeats automation if hit often.
6. **No backlink data on most career-college clients.** Score and verdict logic must degrade gracefully when Semrush data is absent. Currently handled via missing-subscore neutralization, but verdict edge cases ("post has authority" → leave-as-blog) become harder to trigger correctly.
7. **Memo quality drift.** Without examples in `memo_structure.md`, the model may write generic memos that miss the "internal, brutally honest" voice. Few-shot examples ship with the skill; periodic review of generated memos to refresh examples.

## 14. Out of scope (explicit)

- Drafting actual content for new pillar pages.
- Migrating existing posts (the team handles execution after the strategy is set).
- Tracking results over time (no longitudinal analysis — each run is a snapshot).
- Multi-client comparative analysis (each analysis is per-client).
- Continuous re-crawling. Each run consumes a static SF export.

## 15. Phased rollout

- **Phase 1 (next implementation plan): Deterministic backbone.** Per-URL join, page-type classification, embedding-based clustering (Transformers.js + MiniLM), scoring, hub decision, verdicts. Dashboard renders raw output. No skill yet — analyst reads the dashboard directly. Validates the math on real client data. **The writing-plans phase that follows this spec covers Phase 1 only.**
- **Phase 2: Skill + clipboard payload.** Add mint-token endpoint, "Copy Claude Prompt" button, skill ZIP. Narrative memo lives in the dashboard. Separate spec + plan after Phase 1 ships and we have real dashboards to point the skill at.
- **Phase 3: Refinements.** Cluster merge/split UI on the dashboard. Per-client override table for page-type. Subscore weight surfaced in JSON config. Driven by feedback from Phase 1 + 2 use.

Each phase ships its own PR.
