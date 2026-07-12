# C12 Increment D1 — `cat_` content-audit handoff bridge (design)

**Status:** spec — pending Codex review.
**Date:** 2026-07-11.
**Roadmap:** C12 (content auditing) Increment D, sub-increment **D1** (the Option C
bridge). C12 stays `[~]`. Source: `docs/superpowers/nyi/FUTURE-content-auditing.md`
§4 Option C + §6 Increment D.
**Standing gate respected:** NO AI API. This is a skill-handoff clipboard bridge
(the pat_/srt_/krt_/kst_/qct_ family); the LLM analysis happens in an external
Claude session on a flat-rate seat, never through an API this app calls.

---

## 1. Purpose & framing

Let an external Claude session audit a **completed site audit's actual page
content** — cross-page fact consistency, stale claims, and content quality — and
write structured findings back to the dashboard. Zero billing, works today.

This is Option C from the FUTURE doc: the **bridge** that proves the exact finding
schema Option A (a future Anthropic-API extraction job, gated) would later write.
When/if the billing gate opens, Option A swaps the transport (a durable queue job
calling the API) under an **unchanged** ingest contract.

**Measurement-first (house rule):** the ingested findings land as run-metadata
JSON (`CrawlRun.contentAuditJson`), exactly like `contentSimilarityJson` /
`topicOverlapJson`. They are **NOT** promoted to a `Finding` and do **NOT** change
any score in D1. Promotion is a separate, later, gated step with parity evidence.

### Scope of D1 (this increment)

IN: mint-extended `contentText` retention, the `cat_` token, export endpoints
(manifest + per-page full text), the PATCH-ingest endpoint + durable finding
storage, the results-page mint card + read-time findings section, and the
er-handoff-memo skill `cat_` branch.

OUT (explicitly deferred, YAGNI):
- **D2** — recall-first claim-sentence pre-filter + its labeled recall eval on
  real client pages (the FUTURE doc's `~100%`-recall bar is a mini-project needing
  hand-labeled data; the per-page full-text endpoint is the safety net that makes
  the filter a pure optimization, not a prerequisite).
- **D3** — durable per-page content sha256 → incremental "only-changed-pages"
  exports; cross-page boilerplate-drop reuse of the similarity DF machinery.

D1 ships **full stripped text** with no claim filter. Large sites (a 200-page
site ≈ 200–400k tokens of stripped text) are handled by **page-by-page
pagination**, not a single fat response.

---

## 2. Token — `lib/content-audit-token.ts`

Stateless JWT, structural clone of `lib/keyword-strategy-token.ts`:

- Prefix **`cat_`**, issuer `er-seo-tools`, **audience `content-audit-client`**,
  subject = **siteAuditId**, expiry **1h**.
- Scopes **`['read','findings-write']`** (`CONTENT_AUDIT_TOKEN_SCOPES`).
- **Shares `KEYWORD_MEMO_TOKEN_SECRET`** — no new prod env var. The distinct
  audience is the isolation wall (a `cat_` token must never verify against a
  `kst_`/`krt_` audience and vice-versa). Same `getSecret()` (dev fallback when
  `NODE_ENV !== 'production'`, prod throw on unset), same dedicated error class
  `ContentAuditTokenError`.
- `mintContentAuditToken(siteAuditId)` → `{ token, expiresAt }`;
  `verifyContentAuditToken(token, expectedSiteAuditId)` → verified payload, with a
  `token missing cat_ prefix` guard and a `sub` mismatch guard.
- **No session table.** Audit-scoped stateless: the retention stamp lives on
  `SiteAudit`, the ingested findings on the live-scan `CrawlRun`. (kst_ needed a
  session only for its volume ledger; cat_ has no budget.)

### Shared route-auth helper (Codex #5)
`lib/content-audit/route-auth.ts` — one helper the three public routes call:
`requireContentAuditToken(req, siteAuditId, requiredScope)` → verified payload or a
**controlled `401`** (`auth_required` / `insufficient_scope`), never a raw throw
that leaks to a 500. It rejects: missing/`cat_`-less token, a **cross-family
re-prefixed JWT** (a `kst_` body relabeled `cat_` fails the audience check), `sub`
mismatch, expiry, and a scope the route doesn't grant. This centralizes the
fail-closed mapping so no route hand-rolls it.

---

## 3. Retention (mint-extended) — the deliberate-decision reversal

**This reverses the C6-Phase-5 "`contentText` is transient by design" rule.**
Kevin sign-off recorded 2026-07-11 (this brainstorm): mint-extended window.

### Schema
- `SiteAudit.contentAuditRetainUntil DateTime?` (nullable).

### Builder change (`lib/jobs/handlers/broken-link-verify.ts`)
Today (line ~658) the builder does, after `writeFindingsRun`:
```
await prisma.harvestedLink.deleteMany({ where: { siteAuditId } })
await prisma.harvestedPageSeo.deleteMany({ where: { siteAuditId } })
```
New behavior:
- `harvestedLink.deleteMany` — **unchanged** (links stay transient; a populated
  `HarvestedLink` therefore still means "builder didn't finish", which recovery
  relies on).
- **Stamp `SiteAudit.contentAuditRetainUntil = now + BASE_TTL`
  (`CONTENT_AUDIT_BASE_TTL_MS`, default **2h**) BEFORE `writeFindingsRun`
  (Codex #1, crash-safety).** If the process dies between the stamp and the run
  write, there is a stamp but **no** live-scan run → `recoverBrokenLinkVerifies`
  re-enqueues (its `if (liveRun) continue` guard is false) and the builder
  rebuilds idempotently, re-stamping. The reverse order (stamp after) could leave
  a run with retained rows but `retainUntil=null` — recovery skips it (has a run)
  and the export can't reach the text — so stamp-first is the invariant.
- **Do NOT delete `HarvestedPageSeo` in the builder.** Keep the rows (they carry
  `url` + `contentText`) for the retention window.

### Mint extension (atomic, non-shortening)
On `POST …/mint-token`: extend with a `max()` so a concurrent/earlier mint is
never shortened — `contentAuditRetainUntil = new Date(Math.max(current?.getTime()
?? 0, now + CONTENT_AUDIT_TOKEN_TTL_MS))` (≈ now + 1h). Guard against the
already-swept case (Codex #2): if no `HarvestedPageSeo` row with non-null
`contentText` remains, still mint the token but return `textAvailable:false` — the
token is **not** useless (the skill web-fetches the manifest URLs), the human is
just told the retained text is gone.

### Sweep — DELETE at expiry, not null-update (Codex #1 + #2)
`HarvestedPageSeo` has **no `updatedAt` column** (only `createdAt`) — the original
`SET updatedAt=…` SQL would fail, and null-updating leaves the now-useless scalar
rows around to bloat `recoverBrokenLinkVerifies`'s scan set. Instead the new
**`sweepExpiredContentAudit(now)`** DELETEs whole rows once the run exists and the
window has elapsed (`CrawlPage` already holds the durable scalars, so nothing of
value is lost):
```sql
DELETE FROM HarvestedPageSeo
WHERE siteAuditId IN (
  SELECT id FROM SiteAudit
  WHERE contentAuditRetainUntil IS NOT NULL AND contentAuditRetainUntil < <now ms>
)
```
- **Non-null `retainUntil`** is the "run exists, retention set" signal — only those
  rows are swept. **Stranded** audits (crash before the stamp → `retainUntil` null,
  no run) are left untouched for `recoverBrokenLinkVerifies` + the 7-d backstop,
  exactly as today.
- Tagged `$executeRaw` (never an interactive transaction); DELETE has no
  `updatedAt` concern.
- Hosted in the every-10-min `stale-audit-reset` job (tight bounding) **and** in
  `runCleanup`.
- **Existing `pruneHarvestedPageSeo` (7-d)** — unchanged backstop for stranded
  (`retainUntil`-null) rows.

### Recovery efficiency (Codex #1)
Because the sweep DELETEs retained rows at expiry, the retained-`HarvestedPageSeo`
population is bounded to the **~2h retention window**, not 7 days — so
`recoverBrokenLinkVerifies`'s `distinct: ['siteAuditId']` scan stays small and its
`if (liveRun) continue` guard cheaply skips the in-window (run-bearing) audits. No
change to recovery *correctness*; the DELETE-at-expiry design is what keeps it
*cheap*.

### Net privacy delta
Raw stripped text lives **~2h by default** (was ~seconds), extendable to token
life (~1h from mint) on an explicit dashboard mint, and is **DELETEd** (row and
all) at expiry — never null-updated-and-lingering. Read paths independently treat
`retainUntil <= now` as unavailable (below), so text is unreachable the instant the
window closes even before the sweep runs. Pre-change completed audits already had
their `HarvestedPageSeo` deleted by the old builder and carry `retainUntil=null` →
never exportable (Kevin-verify item, §13).

---

## 4. Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/site-audit/[id]/content-audit/mint-token` | cookie-gated | mint `cat_`; guards: audit `complete` + has a `seo-parser` live-scan run + client not archived; extend `retainUntil` (atomic `max()`); return `{token, expiresAt, textAvailable}` |
| `GET /api/site-audit/[id]/content-audit` | **cookie-gated** | **the dashboard card's poll/refetch (Codex #4)** — returns `{minted:boolean, contentAuditJson}` for the audit's live-scan run so the card sees a later public PATCH without reusing the token routes |
| `GET /api/content-audit/[siteAuditId]/manifest` | `cat_` read | context + page index (see §5) |
| `GET /api/content-audit/[siteAuditId]/page` | `cat_` read | one page's stripped `contentText` (pagination unit / per-page full text) |
| `PATCH /api/content-audit/[siteAuditId]/findings` | `cat_` findings-write | strict-validated findings → `CrawlRun.contentAuditJson` |

- All wrap the handler in `withRoute`; the three public routes authenticate via the
  shared `requireContentAuditToken` helper (§2); PATCH parses the body with
  `parseJsonBody` **after** a raw-body size guard (below).
- **Middleware:** exactly **3 anchored single-segment public matchers**
  (`^/api/content-audit/[^/]+/manifest$`, `^/api/content-audit/[^/]+/page$`,
  `^/api/content-audit/[^/]+/findings$`) added to `isPublicPath`. The two
  cookie-gated routes are under the already-gated `/api/site-audit/` tree — no
  matcher. `middleware.test.ts` (Codex #5): a **positive** case per public route,
  plus **negative** cases — a deeper path (`…/manifest/x`) is NOT public, and the
  mint + poll routes 401 unauthenticated.
- **Body-before-auth** on PATCH (mirror the kst_ `…/volumes` order): **raw-body /
  `Content-Length` size guard (Codex #3)** → parse body → `requireContentAuditToken`
  (findings-write) → validate → store. `parseJsonBody` has no size limit of its own,
  so the guard (reject `Content-Length` > the aggregate cap, and cap the read) runs
  first so an unauthenticated caller can't stream an unbounded body.

### Endpoint details

**Read-time expiry enforcement (Codex #2):** both manifest and page treat
`retainUntil == null || retainUntil <= now` as **text-unavailable**, independent of
the sweep cadence — text is unreachable the instant the window closes, not "until
the next 10-min sweep." (The row may still physically exist for a few minutes; the
read path gates on the timestamp, not row presence.)

**manifest** — `requireContentAuditToken(req, siteAuditId, 'read')`. Load the
live-scan `CrawlRun` and its `HarvestedPageSeo` rows. Return:
```
{
  client: { id, name } | null,
  domain, completedAt,
  textAvailable: boolean,          // false when retainUntil <= now OR no text rows remain
  retainUntil: string | null,
  pages: [{ url, title, wordCount, contentAvailable: boolean }]  // indexable ∧ ¬loginLike only
}
```
The **indexable ∧ ¬loginLike** aggregation set is the SAME filter the builder uses
for similarity/signals/on-page/program-entity (`statusCode` 2xx ∧ `isHtml` ∧
¬`robotsNoindex`/`xRobotsNoindex` ∧ ¬`loginLike`). `contentAvailable=false` when the
window has closed or that page's text is gone. This page set is also the
**allowlist** the PATCH evidence-URL binding checks against (§5).

**page** — `?url=<exact normalized page url>`; `requireContentAuditToken(…,'read')`;
return `{ url, contentText, contentTruncated }` only if the URL is in the audit's
indexable set **and** the window is open **and** text is present — else `410`
(`text_unavailable`) for an in-set expired/swept page, `404` for a URL not in the
audit. No enumeration beyond the audit's own pages (token sub-match is the wall).

**findings (PATCH)** — see §5.

---

## 5. Ingest schema — `CrawlRun.contentAuditJson` (nullable TEXT)

```jsonc
{
  "v": 1,
  "generatedAt": "<ISO 8601>",
  "findings": [
    {
      "type": "data_inconsistency" | "stale_claim" | "quality_issue",
      "severity": "info" | "warning" | "critical",
      "title": "<string, capped>",
      "detail": "<string, capped>",
      "evidence": [ { "url": "<string>", "snippet": "<string, capped>" } ],
      "recommendation": "<string, capped>"
    }
  ]
}
```

- **Migration:** add nullable `CrawlRun.contentAuditJson String?` +
  `CrawlRunInput.contentAuditJson` (the writer's `{...run}` spread already carries
  new run fields — no writer change; but this column is written by the PATCH
  route, not the builder).
- **Strict validation on ingest** (`lib/content-audit/ingest-schema.ts`, pure):
  reject unknown `type`/`severity`; cap `findings.length` (e.g. ≤200), each
  `evidence.length` (e.g. ≤20), and every string field length (title/detail/
  snippet/recommendation, e.g. ≤2k each) — reject (400 `invalid_findings`) rather
  than silently truncate.
- **Aggregate byte cap (Codex #3):** per-field caps alone still permit ~MB-scale
  JSON (200 × 20 × 2k). Enforce a **total serialized-byte cap** on the normalized
  `findings` (e.g. ≤256 KB) before persistence → 400 `findings_too_large`. This is
  in addition to the raw-body `Content-Length` guard at the route edge (§4).
- **Evidence-URL binding (Codex #3):** every `evidence[].url` is `normalizeFindingUrl`-
  normalized and **must be a member of this audit's eligible page set** (the same
  indexable∧¬loginLike manifest allowlist). Reject (400 `evidence_url_not_in_audit`)
  any URL that isn't — otherwise the external session could store arbitrary URLs as
  purported audit evidence. (Findings whose `type` is inherently cross-page still
  reference only in-audit URLs.)
- Store `{v:1, generatedAt: server now, findings}` (server clock, not the client's).
- **Last-writer-wins**: a re-PATCH overwrites `contentAuditJson` (idempotent
  enough for a human-driven re-analysis; matches the memo write-back pattern).
- Written to the **live-scan `CrawlRun`** resolved from the siteAudit
  (`source:'live-scan', tool:'seo-parser'`). If no live-scan run exists → 409
  `no_live_scan_run` (same class as `no_findings_run`).

---

## 6. UI

- **`components/site-audit/ContentAuditCard.tsx`** — on the results-page SEO tab
  (inside `SiteAuditResultsShell`, authed only; **share view unchanged**, mirrors
  how content-signals/topic-overlap sit results-only). States:
  - not-eligible (no live-scan run) — hidden or a muted note.
  - eligible — a **Mint** button → shows `Content Audit ID: <siteAuditId>` + the
    `cat_` clipboard payload built by `lib/content-audit-prompt.ts` (mirror
    `lib/keyword-strategy-prompt.ts`), with `expiresAt`.
  - eligible — mint response also carries `textAvailable`; when false the card
    shows an honest "retained text expired — analysis will fetch pages live" note.
  - ingested — renders the `contentAuditJson` findings (grouped by type, severity
    chips, evidence URLs + snippets, recommendation). The card polls the
    **cookie-gated `GET /api/site-audit/[id]/content-audit`** (Codex #4) — NOT the
    public token routes — so a PATCH from the skill surfaces without a manual
    reload.
  - Full dark-mode variants; no hydration-mismatch patterns.
- **`ContentAuditSection`** read-time renderer may be folded into the card's
  ingested state (one component) to avoid a needless split.

---

## 7. Skill (er-handoff-memo) — release prerequisite

New `cat_` branch (bump the skill version; a `references/` doc for the content-audit
document shape):
1. Recognize the `cat_` prefix + `Content Audit ID:` line.
2. `GET …/manifest` → page index.
3. Paginate `GET …/page?url=…` across the indexable set (batch-and-post within the
   session window; respect `textAvailable`false → fall back to web-fetching the
   listed URLs).
4. Analyze: cross-page fact consistency (tuition/length/dates/contact stated
   differently across pages), stale claims (old years/seasons/deadlines), quality
   issues.
5. `PATCH …/findings` with the typed schema (§5).

**Skill routing must land before any deploy that exposes the card** (the kst_
precedent — a card that mints a token no skill understands is a dead end).

---

## 8. Config / env

- **No new prod env var** (shares `KEYWORD_MEMO_TOKEN_SECRET`).
- New tunables (code defaults, documented in `er-seo-tools-config-and-flags`):
  `CONTENT_AUDIT_BASE_TTL_MS` (default 2h), `CONTENT_AUDIT_TOKEN_TTL_MS`
  (default 1h — keep in lockstep with the JWT expiry).

---

## 9. Testing

- **Token** (`content-audit-token.test.ts`): sign/verify round-trip; `cat_`
  prefix guard; `sub` mismatch guard; **audience isolation both directions** — a
  `cat_` token fails `verifyKeywordStrategyToken` AND a `kst_` body re-prefixed
  `cat_` fails `verifyContentAuditToken` (cross-family JWT); prod-unset-secret
  throws, dev fallback warns once.
- **Retention** (Codex #1/#2): builder stamps `retainUntil` **before**
  `writeFindingsRun` and **no longer deletes** `HarvestedPageSeo` (still deletes
  `HarvestedLink`); `sweepExpiredContentAudit` **DELETEs** rows whose audit has a
  non-null `retainUntil < now`, **leaves** stranded (`retainUntil`-null) and
  in-window rows, is idempotent (no `updatedAt` write — the column doesn't exist);
  mint extends via `max()` and never shortens a later window; a crash-simulated
  "stamp but no run" row is re-enqueued by `recoverBrokenLinkVerifies`.
- **Export**: manifest returns indexable-only pages + `textAvailable=false` when
  `retainUntil<=now`; page returns text in-window, `410` for an in-set expired
  page, `404` for a URL not in the audit; token sub-match enforced.
- **PATCH** (Codex #3): rejects unknown type/severity + over-cap lengths/counts
  (400 `invalid_findings`); rejects a payload over the aggregate byte cap (400
  `findings_too_large`); rejects an `evidence.url` not in the audit's page set
  (400 `evidence_url_not_in_audit`); rejects an over-`Content-Length` body at the
  edge before parse; stores `{v:1,...}` with server `generatedAt`;
  last-writer-wins overwrites; `no_live_scan_run` 409.
- **Middleware** (Codex #5): the 3 public routes pass unauthenticated; a **deeper
  path** (`…/manifest/x`) is NOT public; the mint + cookie-gated poll routes 401
  unauthenticated.
- **Component** (`// @vitest-environment jsdom`, `afterEach(cleanup)`, no
  jest-dom — `getByRole`/`getAllByText`, `.toBeTruthy()`/`.getAttribute()`): mint
  button renders when eligible, hidden when not; `textAvailable:false` note
  renders; ingested findings render by type.
- Gates: `npx tsc --noEmit`, `DATABASE_URL="file:./local-dev.db" npm test`,
  `npm run build` — all green before PR.

---

## 10. Migration

Hand-authored (`migrate dev` is interactive-only here):
`prisma/migrations/<ts>_content_audit_bridge/migration.sql` —
```sql
ALTER TABLE "SiteAudit" ADD COLUMN "contentAuditRetainUntil" DATETIME;
ALTER TABLE "CrawlRun" ADD COLUMN "contentAuditJson" TEXT;
```
Apply with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy &&
… generate`. Additive, nullable — no table rebuild, no backfill. Prod applies
automatically on deploy via `prisma migrate deploy`.

---

## 11. Security & invariants checklist

- `cat_` shares the memo secret; **audience** is the only isolation — tested both
  directions incl. a cross-family re-prefixed JWT; all three public routes go
  through the one `requireContentAuditToken` fail-closed helper.
- Export serves **only** the token's own `siteAuditId`, **only** indexable pages,
  **only** within the retention window (read-time `retainUntil` gate, not sweep
  cadence); no cross-audit enumeration.
- PATCH: raw-body/`Content-Length` guard **before** parse → body-before-auth →
  per-field caps + **aggregate byte cap** + **evidence-URL-in-audit binding**;
  findings are metadata JSON, never executed, HTML-escaped at render.
- 3 anchored single-segment middleware matchers — never a `/api/content-audit/`
  prefix; mint + poll stay cookie-gated; positive + negative `middleware.test.ts`
  cases added.
- Retention stamp written **before** the run write (crash-safe); sweep **DELETEs**
  at expiry (no `updatedAt` — column absent), keeping the recovery scan set bounded
  to the window; tagged raw SQL, never an interactive transaction.
- Measurement-first: no `Finding` promotion, no score change.
- Share view unchanged.
- Never scan third-party sites — this feature does zero fetching (the skill may
  web-fetch as a fallback, on client sites already audited).

---

## 12. Deferred / follow-ups

- **D2** claim-sentence filter + labeled recall eval.
- **D3** durable content sha256 + incremental exports + boilerplate drop.
- **Option A** (Anthropic API extraction job) if the billing gate opens — same
  ingest contract, queue-job transport.
- Promotion of `contentAuditJson` to `Finding`/score — separate gated step.

---

## 13. Kevin-verify at deploy (from Codex review)

- **Cold deploy / pre-change audits:** existing completed audits already had their
  `HarvestedPageSeo` deleted by the old builder and carry `contentAuditRetainUntil
  = null` → manifest/page treat them as text-unavailable, so no pre-change audit
  becomes exportable without a fresh (post-change) run + stamp. Confirm on prod.
- **Skill-before-UI:** the er-handoff-memo `cat_` branch must be released before the
  deploy that exposes the mint card (kst_ precedent).
- **Retention volume canary:** on a busy 2-hour window, observe retained stripped-
  text row count + DB size delta + `sweepExpiredContentAudit` duration. Bounded by
  the ~2h window × concurrent-audit rate; the promotion/tuning gate for BASE_TTL.
