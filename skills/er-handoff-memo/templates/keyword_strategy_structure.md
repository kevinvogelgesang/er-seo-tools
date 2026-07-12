# Keyword Strategy Document Template (kst_ — client-scoped)

Produces Kevin's 8-section per-client Keyword Strategy document from the
five-block `kst_` export. This is the client-scoped successor to the krt_
memo — richer inputs, stricter section schema, live volume lookups.

**Reference docs:** program categories, BOFU patterns, intent definitions, and
compliance exclusions belong in this skill's `references/` folder. **Until
they land there** (they currently live in Kevin's Claude project), apply the
"When to Ask" rules below in their place — never guess program taxonomies or
compliance boundaries.

## Section schema (strict)

The document MUST contain these sections in this order, headers exactly as
shown. A section whose data block is absent still appears, with its one-line
"no data" note (rules below).

| # | Header | Content | Primary data |
|---|---|---|---|
| 1 | `## Strategy Overview` | 3–5 sentences: institution type, program portfolio summary, organic visibility snapshot | `profile.institutionType`, `profile.programs`, `gsc.summary.counts` |
| 2 | `## Current Gaps` | High-intent keywords with no observed ranking, grouped by program | `profile.programs` × generated keyword universe, diffed against `gsc.summary` (wins ∪ opportunities) + `semrush.keyword_signals` if present |
| 3 | `## Current Wins` | Queries at position 1–10, table: query / position / impressions / clicks / URL theme | `gsc.summary.wins` |
| 4 | `## Recommendations` | Position 11–20 pages to push (quick wins) + cannibalization fixes (one canonical URL per query, named) | `gsc.summary.quickWins`, `gsc.summary.cannibalization` |
| 5 | `## Keyword Targets` | Up to 100 targets: keyword / volume / intent (I/C/T/N) / traffic potential / target page | generated candidates + the **volumes endpoint** (below) |
| 6 | `## SEMRush Import List` | Plain comma-or-newline list derived from §5 | §5 |
| 7 | `## Article Topics` | New content topics screened against the EXISTING page inventory for duplication/cannibalization — name the colliding URL when you skip a topic | `inventory.pages` (title/h1/pageType) |
| 8 | `## FAQ Page Recommendations` | ONLY pages whose `faqEvidence` is `not-detected` — phrasing rules below are mandatory | `inventory.pages[].faqEvidence` |

Target length: 1,200–2,000 words. Every keyword claim sourced from the export
or the volumes endpoint — never invented.

## GSC hedging (mandatory phrasing)

GSC data is sampled, row-limited, and windowed (`gsc.summary.window`,
`queryAtLimit`/`queryPageAtLimit` flags). A keyword absent from the snapshot
is **"not observed in this GSC window"** — NEVER "not ranking" or "no
visibility". When either `AtLimit` flag is true, add one line noting the data
may be truncated. State the window dates once in §1.

## FAQ tri-state phrasing (mandatory — §8)

- `faqEvidence: "present"` → "FAQ detected (schema markup)" when `faqSignals`
  includes `schema`, else "FAQ detected (page structure)". These pages are
  NOT recommended in §8.
- `faqEvidence: "not-detected"` → **"no FAQ detected — verify before
  recommending"**. NEVER "confirmed no FAQ", never a bare "no FAQ". These are
  §8's candidates.
- `faqEvidence: "unknown"` → "not analyzed" — excluded from §8 entirely
  (historical scans, errored pages). If EVERY page is `unknown`, §8 gets the
  no-data note instead of recommendations.

## Volume lookups (§5) — billable; follow exactly

1. Check the export's `volumeLookup.enabled`. If `false`, write §5 WITHOUT
   volume figures, add: "_Search volumes unavailable — the volume provider is
   not configured; volumes can be added when it is enabled._" Do not call the
   endpoint.
2. Generate candidate keywords FIRST (from programs × BOFU patterns × locale),
   dedupe, cap at ~120 (headroom over the 100 targets). One call:
   `python3 scripts/handoff.py volumes --webapp <W> --token <tok> --id <id> --keywords '["...", ...]'`
   (≤300 keywords per call; each ≤80 chars / ≤10 words — longer ones come back
   in `skipped`).
3. The locale is fixed server-side from the client profile — do not attempt to
   pass one.
4. `outcome: "not_returned"` keywords have no volume data — show "—", don't
   drop them if strategically important.
5. On 429 `volume_budget_exhausted` / `volume_monthly_ceiling`: STOP looking
   up, use what you have, add one line noting the cap. On transport failure,
   retry ONCE with `--idempotency-key <the printed key>`; a
   `duplicate_request` 409 after that means the original may have settled —
   do not mint fresh keys to force retries.
6. Compliance: exclude keywords implying outcomes/guarantees (salary claims,
   "guaranteed job", licensure pass-rate promises) per the compliance
   reference doc; if the doc is not yet in `references/`, apply this minimum
   rule and note that the full exclusion list wasn't available.

## When a block is absent (degrade, don't block)

- `gsc.summary: null` or `gscMapped: false` → §3/§4 get: "_GSC data
  unavailable for this client (no Search Console mapping or no snapshot)._"
  §2 falls back to SEMRush data if present, else states the gap analysis
  needs GSC or SEMRush input.
- `inventory: null` → §7/§8 get: "_No live-scan page inventory available —
  run a site SEO scan from the Audits page to enable topic screening and FAQ
  recommendations._"
- `semrush: null` → simply omit SEMRush references (it is optional additive
  input; do not note its absence).
- `profile.programs` empty → ASK the user for the program roster before
  writing §2/§5 (the instructions' "unclear programs → confirm" rule), or —
  if proceeding was explicitly requested — derive tentative programs from
  `inventory` pageType `program` pages and mark them "(unconfirmed)".
- `profile.locale: null` → volumes will 409 `locale_not_configured`; treat as
  enabled:false for §5 and note the locale needs setting on the client page.

## Post back

Pipe the finished markdown to `handoff.py post` exactly like krt_ (field
`memo`, PATCH `/api/keyword-strategy/{id}/memo`, 50k char cap). Reply in chat
with one short screen: client name, headline counts (wins / quick wins /
gaps / FAQ candidates), volume-lookup spend note if the budget line appeared,
and the dashboard link `{Webapp}/clients/{clientId}`.
