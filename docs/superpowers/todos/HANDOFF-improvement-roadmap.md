# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-11 (**C12 Tier-1 Increment C — MiniLM semantic
topic-overlap cannibalization — SHIPPED** — PR #153; measurement-first, zero-AI,
local ONNX. C12 stays `[~]`. Next: **roadmap menu**.) · **Updated by:** the
C12-Tier-1 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. LAST COMPLETED: C12 Tier-1
Increment C — MiniLM SEMANTIC topic-overlap cannibalization — SHIPPED +
DEPLOYED + PROD-VERIFIED (PR #153). C12 stays [~]. Scope was locked with Kevin
to Increment C ONLY: the cat_ content-audit handoff family (Increment-D bridge,
+ 1-h contentText retention) and Tier-2 AI data-correctness remain future scope
(own specs; Tier-2 OFF per the no-AI-API gate). Zero-AI (LOCAL MiniLM-L6-v2
ONNX, reused from pillar analysis — no API), zero-new-fetch, measurement-first
(NOT a Finding, NO score change) — the SEMANTIC sibling of the lexical
content-similarity + the query-based Increment-A cannibalization. Built
brainstorm → spec (Codex ×5) → plan (Codex ×4) → subagent-driven 6-task TDD →
gates → opus whole-branch review (READY-TO-MERGE, 0 Crit/Important) → merge →
deploy → prod-verify.

WHAT SHIPPED:
- lib/ada-audit/seo/topic-overlap.ts (PURE clusterByTopicOverlap): each page =
  a topic-signature vector (title+H1+meta) + a body-intro vector; combined pair
  sim = W_SIG 0.6*cos(sig) + W_BODY 0.4*cos(body); BOTH vectors required to be a
  clustering candidate (homogeneous metric under one THRESHOLD 0.78);
  single-linkage union-find → connected "topic-overlap networks" (transitive —
  NOT an all-pairs claim); minEdgeSimilarity = weakest DIRECT edge; caps 50/50
  with explicit honest flags (size stays true under member truncation); returns
  null iff clusteredCandidates<2 (>=2 with no edge → non-null clusters:[] =
  "analyzed, clean", so the UI shows "no overlap" not "not analyzed").
  Deterministic (no Math.random/Date.now), pinned constants + bridge fixture.
  Ordinary Node module (NOT .toString()-injected — reuses embedTexts +
  cosineSimilarity from lib/services/pillarAnalysis/embeddings.ts).
- lib/ada-audit/seo/embed-chunked.ts: cooperative embedChunked — bounded chunks
  (32) + inter-chunk event-loop yield (setImmediate) + per-chunk shouldAbort
  deadline → null (no partial). @xenova/transformers runs ONNX SYNCHRONOUSLY on
  the JS thread, so this keeps the embed pass off the job-worker heartbeat's
  critical path (the pdfjs event-loop-starvation incident is the cautionary
  tale). Order-preserving, dependency-injected.
- nullable CrawlRun.topicOverlapJson (additive migration 20260712120000) +
  CrawlRunInput field; rides the writer {...run} spread (NO writer change).
- broken-link-verify.ts builder integration: topic block BETWEEN the
  content-signals and content-similarity blocks, over the SAME indexable ∧
  ¬login-like set, before transient HarvestedPageSeo deletion; reserve chain
  widened (signals guard += TOPIC_OVERLAP_RESERVE_MS 45s; topic guard = TOPIC +
  CONTENT_SIM_RESERVE_MS; sim guard unchanged); shouldAbort protects the
  DOWNSTREAM CONTENT_SIM_RESERVE_MS; ALL eligible pages passed to the clusterer
  (null vecs for non-candidates) so observedPages=eligible while only both-text
  candidates embed; FAIL-TO-NULL (block in try, writeFindingsRun outside).
- components/site-audit/TopicOverlapSection.tsx (mirrors ContentSignalsSection):
  not-analyzed / no-overlap / networks states, linked member URLs, tier labels,
  truncation+clustersCapped notices; wired onto the RESULTS page only — SHARE
  view UNCHANGED (follows content-signals).

NEXT ITEM: roadmap menu — pick one (or take Kevin's steer):
- C12 cat_ content-audit handoff family (Increment-D bridge): new cat_ token
  family + 1-h contentText retention reversal (Kevin sign-off — reverses the
  deliberate "contentText is transient" decision) + recall-first claim-sentence
  filter WITH a measured recall eval on labeled real pages + per-page full-text
  endpoint + PATCH ingest endpoint + er-handoff-memo skill work. Shared with
  KS-6. See nyi/FUTURE-content-auditing.md §4 Option C + §6 Increment D. Own spec.
- SF-retirement parity cycles (see er-seo-tools-sf-retirement-campaign skill).
- Track A infra (A5 shared status hook/SSE; A7 auth hardening + per-worker test
  DBs + Playwright smoke) or Track D remaining.
All start: brainstorm → spec → Codex → plan → Codex → build, rule 4 ungated.

C12 TIER-1 FOLLOW-UPS (non-blocking, from the opus whole-branch review — do
before ANY promotion of topic-overlap to a Finding/score):
- Pure clusterer O(N^2) cosine loop is synchronous no-yield — bounded (<=1000
  candidates), fail-to-null, dwarfed by SAFETY_RESERVE_MS 180s. Add an
  interleaved setImmediate yield if a real large-eligible audit shows material
  block; pair with edges[] per-root running-min (avoid materializing ~500k edge
  objects on a 1000-near-identical-page site).
- Prod canary: measure cold/warm MiniLM RSS + clustering latency on a
  large-eligible-set audit with the Chrome pool active. Confirmed at deploy that
  the @xenova artifact is on disk (no scan-time download); latency/RSS
  observation is the promotion gate, not a ship blocker.

KEVIN STEPS + EYEBALLS (still open): canonical checklist =
docs/superpowers/todos/2026-07-11-kevin-manual-checks-tracker.md (KS-5 end-to-end
run · 4 reference docs into ~/.claude/skills/er-handoff-memo/references/ ·
optional DataForSEO creds · all outstanding authed-UI eyeballs C14-C19/A8 · C12
GscCannibalizationCard + ContentSignalsSection eyeballs · NEW: eyeball the C12
TopicOverlapSection on a fresh live-scan SEO-tab result for a site with
related/competing pages). When Kevin reports an item done, tick it THERE + date
the completed log.

GOTCHAS FOR THE NEXT SESSION:
- Local gates are the ONLY type-check gate (in-build tsc/eslint disabled since
  the 2026-07-11 OOM fix). npx tsc --noEmit + DATABASE_URL="file:./local-dev.db"
  npm test + npm run build, all green, before EVERY merge — no exceptions.
- topic-overlap.ts + embed-chunked.ts are ORDINARY Node modules (NOT
  .toString()-injected — no SWC/typeof contract). BUT they consume the local
  ONNX model via embedTexts, which is a LAZY singleton (~90MB RSS, not
  guaranteed resident) — every qualifying live scan can add it to the worker.
  Feature is fail-to-null so a missing model degrades to a null column.
- topic-overlap constants are PINNED to fixtures (W_SIG 0.6/W_BODY 0.4/threshold
  0.78/caps 50/EMBED_CHUNK 32/BODY_CHARS 2000/MAX_PAGES 1000/RESERVE_MS 45s).
  The bridge fixture LOCKS single-linkage semantics (A-B, B-C above; A-C below →
  ONE network; minEdgeSimilarity = weakest DIRECT edge). Do NOT retune a
  constant or the clustering semantics without updating the fixtures.
- Null contract: null iff clusteredCandidates<2. >=2 candidates with no edge →
  NON-null clusters:[] (analyzed-clean). The builder stores that JSON; the UI
  shows "no overlap detected", never "not analyzed". Don't "simplify" the
  clusterer to return null on empty clusters (it would conflate the two states).
- topicOverlapJson rides the writer's crawlRun.create {...run} spread (no new
  transaction). Reserve order in the builder: signals → topic → similarity; each
  block's skip-guard sums the reserves of ALL blocks after it. Aggregation set =
  indexable∧¬loginLike (SAME as similarity/signals/on-page/program-entity).
  Fail-to-null: a throw / model failure / deadline-abandon must never fail the
  live-scan run write (block in try; writeFindingsRun called outside it).
- broken-link-verify.test.ts uses vi.spyOn (NO vi.mock in that file) — the
  builder tests spy embeddings.embedTexts and embed-chunked.embedChunked; each
  test seeds a fresh SiteAudit + HarvestedPageSeo and re-seeds before a
  throw/abandon rerun (the first run deletes the transient rows). Component
  tests: NO jest-dom → // @vitest-environment jsdom + afterEach(cleanup) +
  getByRole/getAllByText + .toBeTruthy()/.getAttribute() (NOT toBeInTheDocument).
- Migrations: hand-author SQL (migrate dev is interactive-only here), apply with
  DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … generate;
  SQLite: no ALTER COLUMN nullability. Never git add -A (or -u at repo root —
  pentest-results/ + .playwright-mcp/ deletions + skills/er-handoff-memo mods
  are untracked/pre-existing).
- sqlite3 is NOT on the server — verify schema via a read-only Prisma probe
  (node - < script.js over ssh).

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/qct_ clipboard
flow. (DataForSEO is a DATA API — does not touch this gate. The LOCAL MiniLM
embedding model is not an AI API either — it runs on-box, zero network.)

FIRST STEP — confirm main clean + prod healthy (git log origin/main; ssh
seo@144.126.213.242 "curl -s localhost:3000/api/health").

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4):
standing authorization to merge gate-green roadmap PRs (re-run gates in-session)
+ deploy with post-deploy verify; destructive server ops Kevin-gated; spec→plan
ungated (Codex each artifact, notify Kevin one line + path, don't wait). Docs
ritual in the same commit as any ship.
```

---

## Current state (2026-07-11, post-C12-Tier-1)

- **Main** @ `f5add41` (pre-merge) → **PR #153** carries C12 Tier-1 + this ritual
  commit; merge SHA + prod-verify recorded in a finalize commit on main after
  deploy. **Prod on `16e56bb`** (C12 Tier-0) until this deploys.
- **C12 → `[~]`:** Tier-0 (A+B) + Tier-1 Increment C (MiniLM semantic
  topic-overlap) shipped. The `cat_` handoff family (Increment-D bridge) + Tier-2
  AI data-correctness remain future scope (own specs; Tier-2 OFF per the gate).
- **C20 `[x]` — MVP COMPLETE** (KS-1..5). Volume endpoint dark until DataForSEO
  creds land in the prod .env (Kevin).
- **Kevin manual checks:** canonical tracker =
  `todos/2026-07-11-kevin-manual-checks-tracker.md` (now incl. the C12
  TopicOverlapSection eyeball). Sessions tick + log there.

## The single next item

**Roadmap menu** — no single item is pre-committed after C12 Tier-1. Candidates:
the C12 `cat_` content-audit handoff family (own spec — reverses the transient-
contentText decision, needs Kevin sign-off), SF-retirement parity cycles, Track A
infra (A5/A7), Track D, or Kevin's steer. Each starts brainstorm → spec → Codex →
plan → Codex → build.

## Gotchas for the next session

See the paste-in prompt's GOTCHAS block above — it is the authoritative list this
cycle (local-gates-only; topic-overlap pinned constants + bridge-fixture-locked
single-linkage; null-iff-<2-candidates contract; topicOverlapJson-via-spread +
before-similarity reserve chain; fail-to-null; lazy ~90MB MiniLM singleton;
vi.spyOn builder tests + no-jest-dom component convention; hand-authored
migrations).
