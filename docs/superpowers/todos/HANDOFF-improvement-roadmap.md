# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-11 (C20 **KS-4 SHIPPED + DEPLOYED + PROD-VERIFIED, dark** —
PR #149, `b9d693e`. C20 = 4 of 5 MVP increments. Next: KS-5 spec, the capstone.) ·
**Updated by:** the KS-4 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. LAST COMPLETED: C20/KS-4 (FAQ
tri-state detection + page inventory) SHIPPED DARK — PR #149 merged (b9d693e),
deployed + prod-verified 2026-07-11 (migration 20260711000000_crawl_page_faq_evidence
applied, CrawlPage.faqEvidence TEXT nullable live via read-only Prisma probe, clean
boot, 4360 tests / 489 files green). The chain: parse-seo-dom faqSignals (bounded,
injection-contract-safe) → detailsJson → deriveFaqEvidence (lib/ada-audit/seo/
faq-evidence.ts — present:<sigs>|not-detected|NULL=unknown; a malformed/legacy shape
NEVER reads as not-detected) → live-scan builder ensurePage scalar →
CrawlPage.faqEvidence → lib/keywords/page-inventory.ts (parseFaqEvidence strict
decode + pure buildPageInventory: indexable filter, read-time classifyPageType,
programEntityUrls upgrade only at confidence<=0.4). NOTHING consumes it until KS-5.
C20 is [~] — 4 of 5 MVP increments done (KS-1 #146, KS-2 #147 dark, KS-3 #148,
KS-4 #149 dark). Spec/plan pairs all archived.

NEXT ITEM: KS-5 SPEC — the CAPSTONE (umbrella docs/superpowers/specs/
2026-07-10-keyword-strategy-capability-design.md §4 KS-5 + Codex #1/#2). Client-scoped
keyword-strategy export (lean krt_-v2 over a new prefix unless scopes must differ)
minted from the client dashboard, assembling: KS-3 institution profile + confirmed
roster + locale · KS-1 GSC wins/opportunities/quick-wins/cannibalization (freshness:
Kevin Q6 — refresh-on-mint recommended) · KS-4 page inventory (buildPageInventory
over the newest seoIntent live-scan run's CrawlPage rows + programEntitiesJson;
FAQ phrasing per KS-4 spec §7: not-detected = "no FAQ detected — verify before
recommending", NEVER "confirmed no FAQ") · latest live-scan on-page findings. Memo
PATCHes back to the client dashboard (KeywordResearchSession pattern, client-linked).
PLUS the BILLABLE volume-lookup endpoint (Codex: binds to the client-scoped strategy
session for budget accounting — that's why it's KS-5 not KS-2): dedicated
volume-lookup token scope NEVER granted to plain memo tokens; anchored SINGLE-ROUTE
middleware regex + middleware.test.ts case (the 3x-bitten trap); strict request
validation (keyword count/length caps; locale fixed SERVER-SIDE from the client
profile — client input never picks the locale); AbortController timeout + honest
error envelope; persisted per-session usage ledger enforcing the spend cap via
conditional array-form update / EXISTS predicate (stateless JWTs can't count).
Volume calls go through the existing KS-2 layer (getKeywordVolumes — dark until
DATAFORSEO_LOGIN/PASSWORD set in prod .env, a Kevin step, NOT a deploy prereq).
SKILL SIDE (external to repo): fold Kevin's instructions into
~/.claude/skills/er-handoff-memo's krt_ branch + move the 4 reference docs into its
references/. SEMRush CSVs stay an optional additive input. Kevin §5 decisions
pending — spend envelope (drives ledger caps) + token family (krt_-v2 recommended)
+ GSC cadence + FAQ phrasing acceptance; propose defaults in the spec, ask only if
he engages.

RITUAL: spec in docs/superpowers/specs/ → notify Kevin one line + path → Codex review
(consulting-codex skill; session UUID in ~/.claude/state/codex-consultations.json,
budget-check first; er-seo-tools session at turn ~60) → apply named fixes → plan →
Codex → TDD build (subagent-driven) → gates → PR → merge → deploy → prod-verify →
tracker+handoff same commit → archive docs.

AFTER KS-5: MVP COMPLETE (KS-1..5) — Kevin runs the 8-section workflow end-to-end.
Then: KS-6 (optional, SEMRush retirement via DataForSEO Labs + 1-h contentText
export) or back to the main tracker queue.

READ FIRST: the umbrella doc's KS-5 section + KS-4 spec §6/§7 (the inventory seam
KS-5 consumes) + the tracker's top status-log entry (2026-07-11 KS-4). Trust
ranking: code > plan/spec > tracker/handoff.

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
SQLite: no ALTER COLUMN nullability (PRAGMA rebuild). Never git add -A. tsconfig
EXCLUDES **/*.test.ts — tsc never flags test fixtures; sweep via grep + vitest. Test
gotchas: vitest globals:false → afterEach(cleanup) in component tests rendering
repeated text; act() not waitFor under fake timers; getAllBy* for repeated copy;
route files export only handlers+config; Prisma client is a proxy — vi.spyOn on
model methods breaks on mockRestore (use shadow-and-restore or mock the module).
⚠ DEPLOY RECIPE: git push && ssh seo@144.126.213.242 "pm2 stop seo-tools && ~/deploy.sh"
then verify .next/BUILD_ID + health + boot log. sqlite3 is NOT on the server — verify
schema via a read-only Prisma probe (node - < script.js over ssh; PRAGMA rows return
BigInt — Number() them before printing).
```

---

## Current state (2026-07-11, post-KS-4-ship)

- **Main** @ `b9d693e` (PR #149 merge) + this ritual commit. **Prod on `b9d693e`**,
  deployed + verified (fresh BUILD_ID, health ok, migration `20260711000000`
  applied, `faqEvidence TEXT` nullable probed read-only, 0 unstable restarts,
  clean boot).
- **C20 `[~]`** — KS-1..KS-4 SHIPPED (4 of 5 MVP increments). KS-4 Codex trail:
  spec ×5, plan ×4, 6 build tasks all Spec ✅ 0 Critical/Important (several
  mutation-verified), final whole-branch review (Fable) READY-TO-MERGE, all
  minors ship-as-is. 28 new tests.
- **What KS-4 gives KS-5:** per-page `CrawlPage.faqEvidence` on every future
  live-scan run + the pure assembly seam `lib/keywords/page-inventory.ts`
  (`buildPageInventory(pages, { programEntityUrls })` → url/title/h1/pageType/
  wordCount/faqEvidence for indexable pages; `parseFaqEvidence` for consistent
  decode anywhere). Historical runs are honestly `unknown` — never backfill.
- All other tracker state unchanged.

## The single next item

**KS-5 spec** — the capstone: client-scoped krt_-v2 export + billable
volume-lookup endpoint + er-handoff-memo skill upgrade (umbrella §4 KS-5,
Codex #1/#2). Completes the MVP; Kevin's 8-section workflow becomes runnable
end-to-end with near-zero manual data gathering.

## Gotchas for the next session

- **KS-5 touches middleware** — the ONE change class that bit prod 3×: the
  volume-lookup route needs an anchored single-route public regex +
  `middleware.test.ts` case. Never a prefix matcher.
- **Usage ledger:** array-form `$transaction([...])` / conditional-update-with-
  EXISTS only — the cap check is a conditional DB write, never an interactive
  transaction; raw SQL sets `updatedAt` manually (integer ms).
- **faqEvidence semantics are load-bearing:** NULL=unknown ≠ not-detected.
  Export/memo wording for `not-detected` is the hedged §7 default ("no FAQ
  detected — verify before recommending"). `parseFaqEvidence` (page-inventory)
  is the ONLY decoder — never string-match the column ad hoc.
- **page-inventory upgrade rule:** programEntityUrls upgrades pageType only when
  read-time confidence ≤0.4 (unknown/depth-nav) — do not "improve" it to
  override slug classifications; probed against the real classifier.
- **`deriveFaqEvidence` negative gate:** `not-detected` requires EVERY field
  well-formed (heading/container booleans, questionHeadings finite non-negative
  integer, schemaTypes array). Do not simplify the validity checks away.
- **tsconfig excludes `**/*.test.ts`** — `tsc --noEmit` never sees test files;
  required-field sweeps need grep + the vitest run (learned in KS-4 T1).
- **parse-seo-dom injection contract** (any future touch): no module scope, no
  `typeof` (`String(v)===v` for string checks), toString() test is only a keyword
  grep — `next build` is the real SWC gate; sweep `rg -l 'RawPageSeo'` fixtures
  after required-field additions.
- **KS-2 volume layer is env-dark in prod** — enabling = Kevin adds
  `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` to the server `.env` + restart. KS-5
  must degrade honestly when dark (volume columns absent/labelled, never zeros).
- **`normalizeLocale` is the Google Ads provider seam** — untouched by design;
  profile locale is already bare-two-letter canonical; volume-lookup takes locale
  from the client profile server-side, never from the request body.
- `lib/keywords/gsc-snapshot.ts` + `volume-throttle.ts` derived-promise `.catch`
  pattern — do not "simplify" away (unhandled rejection = process crash).
- Latent KS-3 minors (fix on next touch): roster >100 confirm silently drops on
  refetch; Advanced-set locale shows "Not set" in the curated dropdown.
- Rolled-up test debts for KS-5's fixture pass: transport top-level non-20000
  status case; per-entry missing `search_volume` monthly case; route test lacks
  the programs+dismiss `conflicting_ops` row.
- `pentest-results/`, `googlefc472dc61896519a.html`, `SEO_Report_1st_Draft.pdf`
  untracked at repo root — NEVER `git add -A` (or `-u` at repo root).
- Prod deploy uses the interim OOM recipe (`pm2 stop seo-tools && ~/deploy.sh`);
  sqlite3 absent on the server — schema checks via read-only Prisma probe
  (PRAGMA rows return BigInt — Number() before printing).
- A stale `running` example.com SiteAudit can linger in local-dev.db from
  DB-backed test runs — recovery drains it on next dev boot; harmless.
