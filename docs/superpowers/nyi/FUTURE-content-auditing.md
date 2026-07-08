# FUTURE — Content auditing (data correctness, keyword cannibalization, content quality)

**Status:** exploration only — no spec, no plan, nothing committed.
**Gate update (2026-07-08):** the Anthropic-API-billing gated decision was resolved
**NO — no plans to use any AI API at the moment** (roadmap tracker, Gated decisions).
Every AI-dependent check below (data correctness, LLM content quality) is OFF the
table until Kevin reopens that gate; only the zero-AI rows (GSC cannibalization,
stale dates, readability, and the already-shipped similarity/thin checks — plus
topic cannibalization, which uses the LOCAL MiniLM embeddings, not an API) remain
buildable C12 candidates.
**Written:** 2026-07-07, at Kevin's request ("the next goal for the app is to be
able to audit the actual content on the websites"). This doc maps the problem,
what the repo already has, what each check actually requires, and the realistic
options for the AI-dependent parts. Nothing here becomes work until it goes
through the standard spec → Codex → plan → tracker ritual.

---

## 1. What "content auditing" decomposes into

The umbrella covers several distinct checks with very different technical
requirements. Sorted by what they need:

| Check | What it means | Requires |
|---|---|---|
| **Keyword cannibalization (query-based)** | Two+ pages competing for the same search query, splitting clicks/impressions | GSC query×page data — **already integrated** (C10 service account). Pure data join, no AI |
| **Keyword cannibalization (topic-based)** | Two+ pages targeting the same topic even if GSC doesn't show overlap yet | MiniLM embeddings — **already on the server** (pillar analysis) + harvested titles/H1s |
| **Duplicate / near-duplicate content** | Same or nearly-same body text on multiple pages | **SHIPPED** (C6 Phase 5, `contentSimilarityJson`, lexical MinHash) |
| **Stale date references** | "Apply by Fall 2023", old copyright years | Regex over harvested content text. No AI |
| **Readability** | Grade-level / sentence-complexity scoring | Flesch-Kincaid-style formulas over content text. No AI |
| **Thin content** | Pages below word-count threshold | **SHIPPED** (live-scan `thin_content` finding) |
| **Data correctness** | Tuition figures, program lengths, contact info, accreditation claims are *accurate* | (a) LLM extraction of factual claims from prose + (b) a per-client source of truth to check against. **Hardest item** |
| **Cross-page consistency** | The same fact stated differently on two pages (tuition $14,500 on one page, $15,200 on another) | LLM extraction + comparison; sidesteps the source-of-truth registry |
| **Content quality / intent match** | Does the page actually answer the query it ranks for | LLM judgment. Softest, defer |

## 2. Capability tiers (the key framing)

**Tier 0 — deterministic, buildable now, no gates:**
GSC-based cannibalization, stale-date regex, readability. The GSC piece is the
standout: `GSCProvider` (C10) already authenticates via service account per
client; cannibalization = `searchanalytics.query` with dimensions
`[query, page]`, group by query, flag queries where ≥2 pages split meaningful
impressions. It is a report, not a crawl — zero new fetches of client sites.

**Tier 1 — on-server embeddings, already proven:**
`@xenova/transformers` MiniLM (384-dim, in-process ONNX) already powers pillar
clustering on this exact VPS. Topic-overlap cannibalization = embed harvested
page content/titles, flag high-similarity pairs that also share a target
query/keyword. CPU-bound — must run inside the durable job queue (the pdfjs
event-loop incident is the cautionary tale), never in a request handler.

**Tier 2 — generative LLM required:**
Data correctness, cross-page consistency, content quality. **MiniLM cannot do
any of this** — it produces embeddings (similarity numbers), it cannot read a
page and extract "tuition is $14,500". There is no on-server path here (see §4).

## 3. Data correctness — the two halves

Half (a), **extraction**: pulling factual claims out of prose. Regex covers
phones/addresses/years; everything clients actually care about (tuition,
program length, start dates, staff, accreditation) needs an LLM.

Half (b), **source of truth**: no model can know a school's *true* tuition. Two options:

1. **Client facts registry** — a new per-client data model (fact key, value,
   as-of date), human-maintained or eventually CRM-fed. Checks become
   "extracted claim vs registry". Honest requirement regardless of AI choice.
2. **Cross-page consistency mode** — skip the registry; extract claims per page
   and flag *disagreements between pages*. Catches the most embarrassing class
   of error ("two different tuition numbers on the site") with zero data-entry
   burden. Recommended v1 framing for correctness.

## 4. Options for the Tier-2 (LLM) parts

**Option A — Anthropic API (gated on the billing decision, tracker line 394).**
Cost model (verified pricing 2026-07-07; Batch API = 50% off, ideal for
post-audit analysis):

- Haiku 4.5: $1/$5 per MTok → **$0.50/$2.50 batched**
- Sonnet 5: $3/$15 ($2/$10 intro through 2026-08-31) → $1.50/$7.50 batched
- Avg harvested main-content page ≈ 1,000–1,500 words ≈ ~1.5–2k tokens + prompt
- A 200-page site full-content extraction pass ≈ 0.4–0.5M input tokens ≈
  **$0.25–0.50/site with Haiku batched**; ~32 clients monthly ≈ **$10–20/month**
  (Sonnet-class ≈ 3×). Output side is small (structured claims JSON).

Cost is a non-issue; the blocker is purely the standing gate. This is the same
gate as AI memos (Problem 4 in `er-seo-tools-research-frontier`) — content
auditing adds a second, larger consumer to the same decision, which strengthens
the case for deciding it rather than drifting.

**Option B — on-server generative model: NOT viable.** Measured 2026-07-07:
prod VPS has **3.8 GiB RAM total, ~2.1 GiB available, 2 cores, swap already in
use** — plus two memory-incident scars (PM2 SIGKILL 2026-05-14, build OOM
2026-06-22). A quantized 7–8B model needs 5–6 GB and real CPU; even a 3B needs
~2–3 GB and would be minutes-per-page on 2 cores while starving Chrome and the
job worker. MiniLM (~90 MB, embeddings-only) is the ceiling of what this box
runs. A bigger box or GPU host is a stack change (explicit owner decision) that
would cost more per month than Option A's API bill.

**Option C — skill-handoff token family (works today, zero billing).**
A `cat_`-style token, same pattern as pat_/srt_/krt_: dashboard mints a
short-lived JWT, an external Claude session (Desktop/Code on the Team plan)
fetches a structured export, does the analysis, and PATCHes structured findings
back to a validated ingest endpoint.

*Mechanics (explored 2026-07-07; retention direction Kevin-approved same day):*
- **Retained page text beats web-fetch — Kevin's 1-hour retention idea is the
  right call, not naive.** Direction approved 2026-07-07: keep
  `HarvestedPageSeo.contentText` for **1 hour after audit completion** (instead
  of the builder deleting it immediately), dumped by a sweep if no handoff is
  triggered. The export then serves the already-stripped main-content text
  (nav/header/footer/aside removed in-page, ≤30k chars/page) — roughly **3–5×
  lighter than the Claude session web-fetching the same pages** (web fetch
  returns full page HTML→markdown including all the boilerplate the harvest
  already strips, plus per-fetch overhead/latency/failures), and deterministic.
  Privacy weight is modest: the text already sits in the DB transiently for the
  audit's duration; this extends the window by a bounded hour. Mechanics: the
  builder skips the contentText wipe; a sweep nulls text at completion+1h (or
  immediately once the handoff export consumes it); the 7-d row backstop and
  `recoverBrokenLinkVerifies` are unaffected (recovery requires "no live-scan
  run", which exists by then).
- **Filtering ladder** (each step cuts the handoff further; combine freely):
  1. *Scope*: indexable, non-login HTML pages only (the aggregation set the
     builder already computes) — drops utility/wall pages for free.
  2. *Claim-sentence pre-filter* (server-side, deterministic). **Design bar
     (Kevin, 2026-07-07): recall-first and MATURED — nothing potentially
     usable may be filtered out.** Concretely: (a) err on inclusion — any
     sentence matching a claim signal (numbers, currency, dates, percentages,
     phone patterns, durations like "18-month program", accreditation/named-
     entity patterns) is kept WITH its neighboring sentence(s) for context;
     ambiguous cases are always included, never dropped; (b) the filter ships
     with a labeled evaluation sample (hand-marked claim sentences from real
     client pages) and a measured recall number — it is not trusted until
     recall on that sample is ~100%, precision is merely nice-to-have;
     (c) the on-demand full-text endpoint (step 5) is the safety net for
     anything the filter misjudges — the skill can always pull the whole page;
     (d) if the Anthropic billing gate opens later, a Haiku-class batch pass
     can replace the regex tier as a smarter, still-cheap filter. Expected
     reduction with a recall-first posture is lower (~50–80% instead of
     70–90%) — a 200-page site lands roughly **50–120k tokens**, still
     single-conversation territory for most sites.
  3. *Cross-page boilerplate drop*: reuse the content-similarity
     document-frequency machinery to remove text blocks repeating on ≥3 pages
     that the in-page strip missed (CTAs, footers-in-main, promo banners).
  4. *Incremental exports*: persist a tiny per-page content sha256 durably
     (a hash, not text — no privacy weight) and export only pages whose content
     changed since the last audited pass — the big win for monthly re-audits.
  5. *On-demand full text*: the token also exposes a per-page full-text
     endpoint so the skill can pull complete context for a specific page when
     a claim needs it — keep the default export lean, escalate per page.
- Without filtering, full stripped text for a 200-page site is ~200–400k tokens
  (batch-and-post across the session); with the claim filter it's a single
  conversation. Web-fetch fallback remains for post-1-hour handoffs.
- **Team-account token economics (non-API)**: flat-rate seats — marginal cost
  is $0. The constraint is usage limits, not billing: rolling ~5-hour session
  windows plus weekly caps, consumed faster on Opus-class than Sonnet-class
  models (limits are dynamic/opaque; treat numbers as rough). A full-site
  content pass (~0.5M tokens processed through batches) is a large bite of one
  seat's 5-hour window — realistic for **one or two ad-hoc client audits per
  seat per day**, not for scheduled fleet-wide monthly runs (32 clients ×
  monthly through a human-driven seat is exactly the manual chore this app
  exists to remove).

Ships without the billing gate and proves the finding schema (the PATCH-ingest
endpoint and finding types are identical to what Option A would write) — so C
is a genuine bridge, not throwaway: if the gate later opens, Option A swaps the
transport (queue job + API) under the same contract.

**Recommendation:** A for the end state, C as the bridge if the gate stays
closed. B is a dead end on this infrastructure.

## 5. Architectural constraints to respect

- **`contentText` is transient by design** (C6 Phase 5 privacy/size decision:
  captured per page, used in the builder, deleted with `HarvestedPageSeo`,
  never durable/logged). Content auditing needs text at analysis time. Three
  options, in escalating order of decision-weight:
  1. Compute everything in the builder before deletion (current pattern) —
     works for Tier 0/1 sync checks, NOT for a slow LLM pass.
  2. Persist bounded durable content text (or claim-extraction output only) —
     **revisits a deliberate decision, needs Kevin sign-off** + retention rules.
  3. A separate analysis job refetches pages — more traffic to client sites,
     but no durability change. Persisting *extracted claims* (small, structured)
     rather than raw text is likely the right compromise.
- **The builder's 15-min budget** — any LLM pass is its own durable job type
  (queue, group key, recovery path per `er-seo-tools-extension-recipes`), fired
  post-terminal like `broken-link-verify`, never inline.
- **Measurement-first house pattern** — new signals land as run-metadata JSON
  (like `contentSimilarityJson` / `discoveryCoverageJson`) first; promotion to
  `Finding`/score is a separate gated step with parity evidence.
- **Never scan third-party sites**; GSC/embedding work is zero-fetch anyway.
- **GSC quota/availability** — per-client property access already granted (C10
  prod-verified 2026-07-02); cannibalization adds one query×page fetch per
  report, well within quota.

## 6. Suggested sequencing (if/when committed)

1. **Increment A — GSC cannibalization report** (Tier 0, no gate, ~small).
   Highest value-to-effort in the whole space: real deliverable finding
   ("these 4 queries have 2+ pages competing"), pure join on an integration
   that already works, surfaces on the client dashboard / reports.
2. **Increment B — stale-date + readability signals** (Tier 0, no gate, tiny).
   Computed in the builder alongside content similarity, stored as run metadata.
3. **Increment C — embedding topic-overlap** (Tier 1, no gate, medium).
   Needs the contentText-availability decision (§5) resolved first.
4. **Increment D — data correctness** (Tier 2, **gated**). Force the Anthropic
   billing decision with the §4 cost model; if opened, spec the extraction job
   + cross-page consistency v1 (registry later); if closed, spec the `cat_`
   handoff family instead.

## 7. Open questions for Kevin

1. Anthropic API billing — decide the gate (cost estimate above: ~$10–20/mo for
   fleet-wide monthly correctness passes with Haiku, on top of single-digit
   memo cost). One decision now covers memos + content auditing.
2. Data correctness v1 shape: cross-page consistency only, or is a per-client
   facts registry (with the data-entry burden) wanted from the start?
3. Is durable storage of extracted claims (not raw page text) acceptable, or
   should analysis always refetch?
4. Priority of Increment A (GSC cannibalization) vs the other open roadmap
   items (A8 widget editor is the current next action).
