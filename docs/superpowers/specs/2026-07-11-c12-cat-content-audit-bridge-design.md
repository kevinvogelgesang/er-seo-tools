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
- `harvestedLink.deleteMany` — **unchanged** (links stay transient).
- **Do NOT delete `HarvestedPageSeo`.** Keep the rows (they carry `url` +
  `contentText`). Stamp `SiteAudit.contentAuditRetainUntil = now + BASE_TTL`
  (`CONTENT_AUDIT_BASE_TTL_MS`, default **2h**) in the same settle.
- `recoverBrokenLinkVerifies` is unaffected: its precondition requires "**no**
  live-scan run", which is false by the time this stamp is written.

### Mint extension
On `POST …/mint-token`: `contentAuditRetainUntil = new Date(max(current ?? 0,
now + CONTENT_AUDIT_TOKEN_TTL_MS))` (≈ now + 1h) — the human is analyzing now, so
keep the text alive for the token's life even if the base window elapsed.

### Sweeps
- **New `sweepContentAuditText(now)`** (in `lib/findings/retention.ts` or a
  sibling), run on a ≤30-min cadence — host it in the existing every-10-min
  `stale-audit-reset` scheduled job (tight bounding) **and** in `runCleanup`:
  ```sql
  UPDATE HarvestedPageSeo
  SET contentText = NULL, contentTruncated = 0, updatedAt = <now ms>
  WHERE contentText IS NOT NULL
    AND siteAuditId IN (
      SELECT id FROM SiteAudit
      WHERE contentAuditRetainUntil IS NULL OR contentAuditRetainUntil < <now>
    )
  ```
  (raw SQL sets `updatedAt` manually; array-form / tagged `$executeRaw` — never an
  interactive transaction.) This nulls the raw text once the window elapses;
  scalar rows survive to the 7-d backstop.
- **Existing `pruneHarvestedPageSeo` (7-d)** — unchanged; deletes whole rows as
  the backstop (was the primary lifecycle, now the backstop since the builder no
  longer deletes).

### Net privacy delta
Raw stripped text lives **~2h by default** (was ~seconds), extendable to token
life (~1h from mint) on an explicit dashboard mint. Bounded and swept. Scalar
`HarvestedPageSeo` rows without text now persist up to 7 d (previously deleted
immediately) — low-weight (title/word-count/status), covered by the existing prune.

---

## 4. Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/site-audit/[id]/content-audit/mint-token` | cookie-gated | mint `cat_`; guards: audit `complete` + has a `seo-parser` live-scan run + client not archived; extend `retainUntil`; return `{token, expiresAt}` |
| `GET /api/content-audit/[siteAuditId]/manifest` | `cat_` read | context + page index (see §5) |
| `GET /api/content-audit/[siteAuditId]/page` | `cat_` read | one page's stripped `contentText` (pagination unit / per-page full text) |
| `PATCH /api/content-audit/[siteAuditId]/findings` | `cat_` findings-write | strict-validated findings → `CrawlRun.contentAuditJson` |

- All wrap the handler in `withRoute`; bodies parsed with `parseJsonBody`.
- **Middleware:** exactly **3 anchored single-segment public matchers**
  (`^/api/content-audit/[^/]+/manifest$`, `^/api/content-audit/[^/]+/page$`,
  `^/api/content-audit/[^/]+/findings$`) added to `isPublicPath` + a
  `middleware.test.ts` case for each (and a case proving the mint route stays
  gated). The mint route is under the already-gated `/api/site-audit/` tree — no
  matcher needed.
- **Body-before-auth** on PATCH (mirror the kst_ `…/volumes` order): parse body →
  verify token → scope check → validate → store.

### Endpoint details

**manifest** — resolve `siteAuditId` from the URL, `verifyContentAuditToken(token,
siteAuditId)`. Load the live-scan `CrawlRun` and its `HarvestedPageSeo` rows.
Return:
```
{
  client: { id, name } | null,
  domain, completedAt,
  textAvailable: boolean,          // false once swept
  retainUntil: string | null,
  pages: [{ url, title, wordCount, contentAvailable: boolean }]  // indexable ∧ ¬loginLike only
}
```
The **indexable ∧ ¬loginLike** aggregation set is the SAME filter the builder uses
for similarity/signals/on-page/program-entity (`statusCode` 2xx ∧ `isHtml` ∧
¬`robotsNoindex`/`xRobotsNoindex` ∧ ¬`loginLike`). `contentAvailable=false` for a
page whose `contentText` was already nulled.

**page** — `?url=<exact normalized page url>`; verify token; return
`{ url, contentText, contentTruncated }` for that page if it is in the audit's
indexable set and text still present, else `404`/`410` (`text_unavailable`). No
enumeration beyond the audit's own pages (token sub-match is the wall).

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
  than silently truncate. Store `{v:1, generatedAt: server now, findings}`.
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
  - ingested — renders the `contentAuditJson` findings (grouped by type, severity
    chips, evidence URLs + snippets, recommendation). Light poll / on-load fetch
    so a PATCH from the skill surfaces without a manual reload.
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
  prefix guard; `sub` mismatch guard; **audience isolation** — a `cat_` token
  fails `verifyKeywordStrategyToken` and a `kst_` token fails
  `verifyContentAuditToken`; prod-unset-secret throws, dev fallback warns once.
- **Retention**: builder stamps `retainUntil` and **no longer deletes**
  `HarvestedPageSeo` (but still deletes `HarvestedLink`); `sweepContentAuditText`
  nulls text past `retainUntil`, leaves in-window text, is idempotent, sets
  `updatedAt`; mint extends `retainUntil`.
- **Export**: manifest returns indexable-only pages + correct `textAvailable`;
  page endpoint returns text in-window, `410` post-sweep, `404` for a URL not in
  the audit; token sub-match enforced.
- **PATCH**: rejects unknown type/severity, over-cap lengths/counts (400); stores
  `{v:1,...}`; last-writer-wins overwrites; `no_live_scan_run` 409.
- **Middleware**: the 3 public routes pass unauthenticated; the mint route 401s
  unauthenticated.
- **Component** (`// @vitest-environment jsdom`, `afterEach(cleanup)`, no
  jest-dom — `getByRole`/`getAllByText`, `.toBeTruthy()`/`.getAttribute()`): mint
  button renders when eligible, hidden when not; ingested findings render by type.
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
  directions.
- Export serves **only** the token's own `siteAuditId`, **only** indexable pages,
  **only** within the retention window; no cross-audit enumeration.
- PATCH is strictly validated + size-capped; body-before-auth; findings are
  metadata JSON, never executed, HTML-escaped at render.
- 3 anchored single-segment middleware matchers — never a `/api/content-audit/`
  prefix; mint stays cookie-gated; `middleware.test.ts` cases added.
- Array-form `$transaction` / tagged raw SQL only; `updatedAt` set manually in raw
  statements.
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
