# Keyword Strategy capability — gap analysis + umbrella plan (KS)

**Status:** umbrella design — gap analysis + phased plan. Each increment below gets
its own spec/plan per the standard ritual before build.
**Written:** 2026-07-10, at Kevin's direction (chose this over the roadmap menu after
closing A8). Source requirement: Kevin's Claude-project "Keyword Research for
Educational Institutions" instructions + 4 reference docs (program categories, BOFU
patterns, intent definitions, compliance exclusions), pasted 2026-07-10.
**Standing gate honored throughout:** NO AI API — strategy *generation* stays the
krt_ clipboard skill-handoff. The app's job is to assemble the data package and
serve lookups so the skill can produce the full document without manual data
gathering (today: a Screaming Frog crawl + SEMRush exports + hand-collected
program lists per client).

---

## 1. The target workflow (what the output requires)

Kevin's instructions produce a per-client Keyword Strategy markdown doc with 8
sections. Each has hard data dependencies:

| # | Section | Data required |
|---|---------|---------------|
| 1 | Strategy overview | Program portfolio, organic visibility summary |
| 2 | Current gaps (high-intent keywords with no ranking) | Program roster + generated keyword universe + the site's *actual* ranking set to diff against |
| 3 | Current wins (ranking 1–10) | Query-level position data (GSC or SEMRush) |
| 4 | Recommendations (incl. pages ranking 11–20) | Query×page position data |
| 5 | 100 keyword targets w/ **search volume**, intent, traffic potential | Volume source (SEMRush CSV today; DataForSEO candidate); intent = skill-side rules |
| 6 | SEMRush import list | Derived from §5 |
| 7 | Article topics (screened against existing blog titles for duplication/cannibalization) | Full page inventory with titles + page-type (blog vs program) |
| 8 | FAQ page recommendations (only pages *confirmed* to lack a FAQ) | Per-page FAQ-presence signal (content or structured data) |
| — | Compliance filter | Static blocklist (skill-side reference doc) |
| — | Institution type + program offerings | Per-client metadata (none exists in-app) |

Inputs per the instructions: crawl data (SF + GA4/GSC) **or page text**; school
type + programs; optional SEMRush exports / competitor URLs.

## 2. Current state (verified in code, 2026-07-10, main @ c2ce9b7)

What the app can already contribute:

- **krt_ flow exists but is SEMRush-CSV-bound.** `/keyword-research` sessions
  (`Session.workflow='keyword-research'`) parse three manually-exported SEMRush
  CSVs (Organic Positions / Organic Pages / Keyword Gap "Missing");
  `computeKeywordSignals()` (`lib/services/aggregator.service.ts:788`) derives
  cannibalization, quick wins (pos 11–20 ∧ vol ≥100), optimization gaps, top
  pages; `buildKeywordResearchExport` (`lib/parsers/keyword-research-export.ts`)
  serves it under a krt_ token (gap keywords capped 500); the memo PATCHes back.
  **Search volume comes exclusively from SEMRush CSV columns.**
- **GSC integration exists but is report-scoped.** `GSCProvider`
  (`lib/analytics/google/gsc-provider.ts`) authenticates per client
  (`Client.gscSiteUrl`, C10 service account, prod-verified) but fetches only 3
  shapes: totals, date series, top-100 queries (with position). **No
  `[query, page]` dimension fetch exists anywhere**, and the provider's only
  caller is the C10 report renderer. Not wired to keyword research at all.
- **Page inventory is durable per live-scan.** `CrawlPage` rows on a seoIntent
  live-scan run carry url/title/h1/metaDescription/wordCount/indexable/
  inlinks/outlinks — everything §7's blog-title screening needs, already in the DB.
- **Page-type classification exists.** Pillar analysis
  (`lib/services/pillarAnalysis/pageType.ts`) classifies `program` pages via slug
  (`/program(s)/`) + schema.org `Course`/`EducationalOccupationalProgram`, and
  blog/informational types — raw material for a program-roster *suggester*, but
  no canonical program-name extraction and **no durable per-client roster**.
- **`Client` has zero vertical metadata.** No school-type, program list, or
  geographic-market fields (`prisma/schema.prisma:16-36`).
- **Page content: transient, with an approved retention direction.**
  `HarvestedPageSeo.contentText` (stripped main content, ≤30k/page) is deleted
  when the live-scan builder finishes. Kevin approved (2026-07-07, recorded in
  `../nyi/FUTURE-content-auditing.md` §4 Option C) keeping it for **1 hour
  post-completion** to serve token-authed content exports. Not yet built.
- **No DataForSEO/SEMRush API client exists.** SEMRush is CSV-only; `dataforseo`
  appears in docs only. The tracker's gated-decisions note already distinguishes
  this as a **data-API billing question, not an AI-API question** — and Kevin
  states (2026-07-10) **we have DataForSEO API access**, which resolves the
  access half of that question.
- **FAQ presence: not detected.** `parse-seo-dom.ts` already extracts JSON-LD
  `@type` values in-page (so `FAQPage` schema is *almost* free) but no FAQ
  signal is derived, persisted, or exported.
- **Prior art:** `../nyi/specs/FUTURE-keyword-research-tool-design.md` (2026-04,
  placeholder — superseded by this doc for direction, kept for its SF
  All-Page-Text notes) and `../nyi/FUTURE-content-auditing.md` (C12 exploration —
  its Tier-0 GSC query×page cannibalization is the SAME fetch KS-1 needs; build
  once, serve both).

## 3. The gaps

| ID | Gap | Blocks section(s) | Severity |
|----|-----|-------------------|----------|
| G1 | No query×page GSC data in the keyword flow (wins/opportunities/rank-diff all depend on SEMRush CSVs) | 2, 3, 4 | **Core** |
| G2 | No keyword search-volume source except manual SEMRush CSV | 5, 6 | **Core** |
| G3 | No per-client program roster / institution type / geo markets | 1, 2, 5 | **Core** |
| G4 | krt_ export is session-bound (SF/SEMRush upload) — no client-scoped export drawing on live-scan + GSC | all | **Core** |
| G5 | No page inventory (titles + page types) in the krt_ export for article-topic screening | 7 | Medium |
| G6 | No FAQ-presence signal per page | 8 | Medium |
| G7 | Skill-side: `er-handoff-memo`'s krt_ branch produces the *old* memo, not Kevin's 8-section strategy doc; the 4 reference docs live in a Claude project, not the skill | all | **Core (external)** |
| G8 | No page-content export (the "or page text" input; deeper topic analysis) | 7, 8 enhancer | Low (direction approved, C12-shared) |

Explicitly **not** gaps (skill-side by design, no app work): keyword *generation*
(BOFU patterns), intent classification (I/C/T/N), compliance filtering, the
strategy prose itself. These live in the skill's reference docs per the NO-AI-API
gate.

## 4. Plan — increments (each gets its own spec → Codex → plan)

Ordered so every increment ships standalone value; KS-5 is the capstone that
turns them into Kevin's one-click flow.

### KS-1 — GSC query×page ingestion (G1) — ~2–3 days
Add a `[query, page]` (+ query-only) Search Console fetch for a client, stored as
a client-scoped snapshot (new model or run-metadata JSON — spec decides; must
survive the memo window, not live in a request). Derive **wins (pos 1–10),
opportunities (11–30), quick wins (11–20)** and **query×page cannibalization**
(≥2 pages splitting impressions on one query) — the latter is literally C12
Increment A from `FUTURE-content-auditing.md` §6; one fetch serves both features.
Zero site fetches; quota already established per C10. Surfaces: client dashboard
card + feeds KS-5's export.
**Completeness semantics (Codex #4):** GSC query data is sampled and row-limited,
and position is an aggregate — a keyword absent from the snapshot is **"not
observed in this GSC window"**, never proof of not ranking. The snapshot must
carry explicit metadata: date window, row limit + truncation flag, minimum-
impression threshold, fetched-at freshness; the spec names the refresh owner/
cadence. Gap/cannibalization claims in the export and memo use the hedged
phrasing, and the skill instructions inherit it.

### KS-2 — DataForSEO volume provider + cache (G2) — ~2 days
New `lib/keywords/` provider hitting DataForSEO (Keywords Data / Labs — endpoint
choice + **current pricing, location-code model, and retry semantics verified at
spec time**, never from memory), dark by default behind
`DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` env (config-and-flags recipe; missing
env → feature hidden, never a boot failure). Scope (Codex #1): **provider +
durable volume cache only** — the token-authed lookup endpoint moves to KS-5,
where the client-scoped session it must bind to exists. In-repo consumer now:
optional pre-enrichment of KS-1's GSC query set in the export.
**Locale is structured (Codex #3):** volumes require location/language codes,
not freeform market names — the client keyword profile (KS-3) carries a primary
locale, and cache rows are keyed by normalized keyword + location code +
language + provider version (30-d TTL) so re-runs are ~free.
Cost envelope is a Kevin decision (§5 Q1). SSRF posture: fixed allowlisted API
host, never user-supplied URLs.

### KS-3 — Client program roster + institution profile (G3) — ~2 days
`Client` gains structured metadata: `institutionType`
(trade/bootcamp/university/k12 + an `other` escape hatch — §5 Q5), a
**structured `programs` roster (Codex #7)** — JSON array of
`{ name, url?, aliases?, credentialLevel?, confirmed }` objects, NOT bare name
strings, with auto-suggestions retained separately from confirmed entries — and
a **keyword locale profile** (location/language codes for DataForSEO +
market names for display; Codex #3). Editable on the client manage page.
**Auto-suggest, operator-confirm:** a "Suggest from latest scan" action derives
candidates from the newest live-scan run (program-typed pages via the pillar
classifier + JSON-LD Course/EducationalOccupationalProgram names + title/H1
tokens) — suggestions only; the durable roster is human-confirmed (matches the
instructions' "unclear programs → confirm" rule).

### KS-4 — Page-inventory + FAQ signals (G5, G6) — ~1–2 days
(a) FAQ-presence detection in `parse-seo-dom.ts`: JSON-LD `FAQPage` (already
extracted) + a bounded DOM heuristic (faq-ish headings/accordions). **The
injected-function contract is absolute:** self-contained, no module scope, no
SWC-helper-emitting constructs (no `typeof`) — verified at es2017, per the
`cc8d1c1` incident class. **Tri-state evidence, not a boolean (Codex #6):**
detection can prove *presence*, never absence — persist
`present | not-detected | unknown` (+ parse status/reason), and the skill/export
phrase `not-detected` as "no FAQ detected — verify", never "confirmed no FAQ".
Persist per page (`HarvestedPageSeo` → nullable `CrawlPage` column, so
historical exports distinguish unknown from not-detected).
(b) Page inventory in the export: url/title/h1/pageType/wordCount/faqEvidence
for indexable pages from the newest seoIntent live-scan run — powers §7
duplicate screening and §8 candidate selection.

### KS-5 — Client-scoped keyword-strategy export + volume endpoint + skill upgrade (G4, G7) — ~3–4 days app + skill work
A new client-scoped export (spec decides: extend krt_ vs a new `kst_` family —
lean krt_-v2 unless scopes must differ), minted from the client dashboard,
assembling: institution profile + roster (KS-3), GSC wins/opportunities/
cannibalization (KS-1), page inventory + FAQ signals (KS-4), and latest
live-scan on-page findings. Memo PATCHes back to the client dashboard (existing
KeywordResearchSession pattern, client-linked).
**Volume-lookup endpoint lands here, not KS-2 (Codex #1):** it must bind to the
client-scoped strategy session for budget accounting, which doesn't exist
before this increment. **It is a billable capability, not a read (Codex #2):**
dedicated `volume-lookup` token scope (never granted to plain memo tokens);
anchored single-route `middleware.ts` public regex + `middleware.test.ts` case;
strict request validation (keyword count/length caps, locale fixed server-side
from the client profile); AbortController timeout + honest error envelope; and
a **persisted per-session usage ledger** enforcing the spend cap — stateless
JWTs can't count requests, so the cap check is a conditional DB update
(array-form `$transaction`/`EXISTS` predicate per house rules, never an
interactive transaction). The skill generates candidate keywords, POSTs the
list, gets volumes back mid-conversation.
**Skill side (external to this repo):** fold Kevin's instructions into
`~/.claude/skills/er-handoff-memo`'s krt_ branch and move the 4 reference docs
into its `references/` — versioned with the skill, not served by the app
(they're generation logic, not client data). SEMRush-CSV sessions remain
supported as an *optional additive* input, per the instructions.

### KS-6 (later, optional) — SEMRush retirement for keyword data + content export (G8)
DataForSEO Labs ranked-keywords / domain-intersection to replace the manual
Organic-Positions + Keyword-Gap CSVs entirely (this is SF-retirement Phase 6's
keyword half — tie the increments together in that campaign's ledger), and the
already-approved 1-hour contentText retention + per-page content endpoint
(shared with C12 Option C) as the "or page text" input. Neither blocks Kevin's
workflow running end-to-end after KS-1..5.

**MVP line (Codex #5): KS-1 through KS-5 inclusive.** KS-4 is REQUIRED for the
full 8-section workflow — §8 ("only pages confirmed to lack a FAQ") and §7's
duplicate screening cannot be satisfied without it; shipping without KS-4 is a
*degraded* workflow in which the skill must ask Kevin for FAQ/blog verification
per the instructions' "When to Ask". Rough total: ~2 weeks of increments.

## 5. Kevin decisions needed (none block KS-1)

1. **DataForSEO spend envelope** — per-memo cap and monthly ceiling (drives
   KS-5's ledger caps; pricing/endpoints verified at KS-2 spec time).
2. **Roster confirmation UX** — is operator-confirm (KS-3) acceptable, or should
   unconfirmed auto-suggestions flow into the export marked as unconfirmed?
3. **Token family** — krt_-v2 with an added `volume-lookup` scope (recommended)
   vs a new prefix.
4. **SEMRush's ongoing role** — keep CSV path indefinitely as optional input
   (recommended) or plan retirement behind KS-6.
5. **Institution profile shape** — is trade/bootcamp/university/k12 + `other`
   enough, and do roster entries need campus/credential-level fields (per-campus
   geo keywords) from day one or later? (Codex flag)
6. **GSC snapshot cadence** — refresh on memo mint (recommended: always fresh,
   one fetch per memo) vs a scheduled sweep; and the minimum-impression
   threshold for "observed". (Codex flag)
7. **FAQ recommendation phrasing** — is "no FAQ detected — verify before
   building" acceptable in the memo, or must every FAQ recommendation be
   operator-verified before the memo is client-facing? (Codex flag)

## 6. Out of scope (standing decisions honored)

- **No AI API** — generation, intent tagging, compliance filtering stay in the
  skill. Nothing here calls an LLM.
- No new crawling — every increment reads existing live-scan/GSC/DataForSEO
  data; zero additional fetches of client sites.
- No SF parser changes; the keyword-research CSV upload flow keeps working
  untouched until KS-6 is decided.
