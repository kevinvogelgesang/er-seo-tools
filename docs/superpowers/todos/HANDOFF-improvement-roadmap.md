# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-10 (C20 **KS-3 SHIPPED + DEPLOYED + PROD-VERIFIED** — PR
#148, `a053c5e`; same day KS-1 #146 + KS-2 #147. C20 = 3 of 5 MVP increments.
Next: KS-4 spec.) ·
**Updated by:** the KS-3 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. LAST COMPLETED: C20/KS-3 (client
institution profile + STRUCTURED program roster + keyword locale) SHIPPED — PR #148
merged (a053c5e), deployed + prod-verified 2026-07-10 (migration
20260710230000_client_keyword_profile applied, all 7 new columns live via read-only
Prisma probe, routes 401-gated, clean boot, 4332 tests / 487 files green). Client now
carries institutionType / programsJson / programSuggestionsJson /
kwLocationCode+kwLanguageCode+kwMarketLabel; KeywordProfileCard on /clients/[id]
(suggest-from-latest-scan, operator-confirm); live-scan builder now persists durable
CrawlRun.programEntitiesJson (JSON-LD program names — future audits only, old runs
degrade to slug/heading suggestion signals). NOTHING consumes the profile until KS-5.
C20 is [~] — 3 of 5 MVP increments done (KS-1 #146, KS-2 #147 dark, KS-3 #148).
Spec/plan pairs all archived.

NEXT ITEM: KS-4 SPEC — FAQ tri-state detection + page inventory (umbrella
docs/superpowers/specs/2026-07-10-keyword-strategy-capability-design.md §4 KS-4 +
Codex #6). (a) FAQ-presence in parse-seo-dom.ts: JSON-LD FAQPage (@type already
extracted) + a bounded DOM heuristic (faq-ish headings/accordions). THE INJECTED
CONTRACT IS ABSOLUTE: self-contained, no module scope, NO typeof (cc8d1c1 class;
KS-3 used String(v)===v for string checks — same discipline; next build is the real
SWC gate, the toString() test is only a keyword grep). Tri-state EVIDENCE not a
boolean: persist present|not-detected|unknown (+ parse status/reason) — detection
proves presence, never absence; export/skill phrase not-detected as "no FAQ detected
— verify", never "confirmed no FAQ". Persist per page: HarvestedPageSeo → nullable
CrawlPage column (historical exports must distinguish unknown from not-detected).
(b) Page inventory in the export: url/title/h1/pageType/wordCount/faqEvidence for
indexable pages from the newest seoIntent live-scan run — powers umbrella §7
duplicate screening + §8 candidate selection. Spec decisions: DOM heuristic bounds,
CrawlPage column shape (string enum vs json), whether faqEvidence rides the existing
builder page-scalars path (it should — CrawlPage rows are built by the live-scan
builder from HarvestedPageSeo), inventory assembly seam (KS-5 reads it — keep KS-4
storage-only or add a pure builder now).

RITUAL: spec in docs/superpowers/specs/ → notify Kevin one line + path → Codex review
(consulting-codex skill; session UUID in ~/.claude/state/codex-consultations.json,
budget-check first; er-seo-tools session at turn ~58) → apply named fixes → plan →
Codex → TDD build (subagent-driven) → gates → PR → merge → deploy → prod-verify →
tracker+handoff same commit → archive docs.

AFTER KS-4: KS-5 (the capstone: client-scoped krt_-v2 export + BILLABLE
volume-lookup endpoint — dedicated scope, anchored single-route middleware regex +
middleware.test.ts case (the 3×-bitten trap), persisted per-session usage ledger via
conditional array-form update; er-handoff-memo skill upgrade with Kevin's
instructions + 4 reference docs). MVP = KS-1..5. Kevin §5 decisions (spend envelope,
roster UX, token family, SEMRush role, profile shape, GSC cadence, FAQ phrasing) —
ask only if he engages; FAQ phrasing (Q7) becomes live IN KS-4's export wording:
propose the hedged default, Codex reviews.

READ FIRST: the umbrella doc's KS-4 section + the tracker's top status-log entry
(2026-07-10 KS-3 shipped). Trust ranking: code > plan/spec > tracker/handoff.

Kevin eyeballs outstanding (authed-UI): KeywordProfileCard on a client dashboard
(set institution/locale, add a program, hit Suggest on a client WITH a live-scan
run — KS-3) · GscKeywordCard Refresh once (KS-1) · C15 Mine-filter · C16 Audits
page · C17 seoOnly auto-flip · C18 results tabs · C14 /sales + real /sales/[token]
report · re-scan Bellus (v4 badge + invoice; expect ≈68) · post-C19: /settings
SEO+ADA cards + /score-lab · post-A8-PR7: /clients fleet + client dashboard
(weightsHash suppression on first real ScoringWeights save — observe only).

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/qct_ clipboard flow.
(DataForSEO is a DATA API — does not touch this gate.)

FIRST STEP — confirm main clean + prod healthy (git log origin/main; ssh
seo@144.126.213.242 "curl -s localhost:3000/api/health").

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4): standing
authorization to merge gate-green roadmap PRs (re-run gates in-session) + deploy with
post-deploy verify; destructive server ops Kevin-gated; spec→plan ungated (Codex each
artifact, notify Kevin one line + path, don't wait). Docs ritual in the same commit
as any ship.

ENV NOTE: gates = npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm
run build. Migrations: hand-author SQL (migrate dev is interactive-only here), apply
with DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … generate;
SQLite: no ALTER COLUMN nullability (PRAGMA rebuild). Never git add -A. Test gotchas:
vitest globals:false → afterEach(cleanup) in component tests rendering repeated text;
act() not waitFor under fake timers; getAllBy* for repeated copy; route files export
only handlers+config; Prisma client is a proxy — vi.spyOn on model methods breaks on
mockRestore (use shadow-and-restore or mock the module).
⚠ DEPLOY RECIPE: git push && ssh seo@144.126.213.242 "pm2 stop seo-tools && ~/deploy.sh"
then verify .next/BUILD_ID + health + boot log. sqlite3 is NOT on the server — verify
schema via a read-only Prisma probe (node -e with the deployed client).
```

---

## Current state (2026-07-10, post-KS-3-ship)

- **Main** @ `a053c5e` (PR #148 merge) + this ritual commit. **Prod on `a053c5e`**,
  deployed + verified (fresh BUILD_ID, health ok, migration applied, all 7 new
  columns probed read-only, routes 401, 0 unstable restarts, clean boot).
- **C20 `[~]`** — KS-1 + KS-2 + KS-3 SHIPPED (3 of 5 MVP increments), all
  2026-07-10. KS-3 Codex trail: spec ×6, plan ×6, 4 build fix loops (read-side
  parser strictness [Critical]; aggregator tests mutation-hardened; UI refetch
  field-merge deviation reversed — spec LWW governs, the plan's test fixture was
  the bug; form-preserved-on-failure + a11y labels), final opus review
  0 Critical/Important, 8 minors ship-as-is.
- **What KS-3 gives KS-4/KS-5:** the client keyword profile (institution type,
  confirmed roster, locale) + durable `CrawlRun.programEntitiesJson`. KS-5's export
  reads the profile; its volume lookups take the locale from
  `kwLocationCode`/`kwLanguageCode` (already canonical lowercase, bare two-letter).
- All other tracker state unchanged.

## The single next item

**KS-4 spec** — FAQ tri-state (`present|not-detected|unknown`) in parse-seo-dom +
per-page persistence to a nullable CrawlPage column, plus the page inventory for
the export (umbrella §4 KS-4, Codex #6). KS-4 is REQUIRED for the MVP (§7/§8
unsatisfiable without it).

## Gotchas for the next session

- **parse-seo-dom injection contract** (KS-4 touches it AGAIN): no module scope, no
  `typeof` (use `String(v)===v` for string checks — KS-3 precedent), verify with
  the toString() test AND a green `next build`; sweep `rg -l 'RawPageSeo'` fixtures
  after any required-field addition.
- **KS-3's read-parsers are structurally strict** — `checkEntryFields` backs both
  write and read in program-roster.ts; never loosen one side.
- **`normalizeLocale` is the Google Ads provider seam** — untouched by design;
  hyphenated-regional language codes are BLOCKED at the profile (case-sensitivity
  of lowercased regionals on the wire unverified — spec §8.3 records the
  constraint); a Labs endpoint (KS-6) gets its own validator.
- Latent KS-3 minors (ship-as-is, fix on next touch): confirming a suggestion past
  a 100-entry roster silently drops it on refetch; an Advanced-set locale shows
  "Not set" in the curated dropdown; suggest-URL not re-gated through isHttpUrl on
  confirm (server-derived only today).
- `lib/keywords/gsc-snapshot.ts` + `volume-throttle.ts` derived-promise `.catch`
  pattern — do not "simplify" away (unhandled rejection = process crash).
- Rolled-up test debts for KS-5's fixture pass: transport top-level non-20000
  status case; per-entry missing `search_volume` monthly case; route test lacks
  the programs+dismiss `conflicting_ops` row.
- `pentest-results/`, `googlefc472dc61896519a.html`, `SEO_Report_1st_Draft.pdf`
  untracked at repo root — NEVER `git add -A`.
- Every new public/token route: middleware `isPublicPath` + `middleware.test.ts`
  case (bit prod 3×). KS-4 adds NO routes; KS-5's volume-lookup needs exactly one
  anchored regex.
- Array-form `$transaction([...])` only; KS-5's usage ledger = conditional update /
  EXISTS predicate, never interactive.
- Prod deploy uses the interim OOM recipe (`pm2 stop seo-tools && ~/deploy.sh`);
  sqlite3 absent on the server — schema checks via read-only Prisma probe.
- A stale `running` example.com SiteAudit can linger in local-dev.db from DB-backed
  test runs — recovery drains it on next dev boot; harmless.
