# Clients + Quarter Grid — Improvement Roadmap

**Date:** 2026-06-10 · **Status:** NYI strategy doc
**Scope:** `app/clients/**` (561-LOC admin page), `app/quarter-grid/**` (1,215-LOC monolith page), `components/clients/**`, client FKs across every other tool

---

## Current state (verified)

- **Client model is thin but well-connected:** every tool already links to
  `Client` (Session/AdaAudit/SiteAudit direct FKs; pillar/roadmap/keyword via
  session). Domain auto-matching assigns sessions to clients on parse.
- **But there is no client view.** `/clients/[id]` shows *parser sessions
  only* (trend chart + diff link via the one client-centric service,
  `client-seo-history.ts`, 53 LOC). ADA audits, site audits, pillar analyses,
  keyword memos, roadmaps — all reachable only through their own tools'
  history lists.
- **Quarter Grid is a 1,215-line single component** with hand-rolled HTML5
  drag-and-drop, and its real business state — per-client priority, status,
  notes, week assignments, layouts — lives in **localStorage**
  (`seo-quarter-v3`). Clear the browser, lose the quarter plan. Second
  analyst opens it, sees nothing. v1/v2/v3 routes are now just redirects.
- `Client.domains` and `seedUrls` are JSON strings; domain matching is an
  O(clients × domains) scan per parse (fine at 30 clients, just inelegant).
- `teamworkTasklistId` exists on Client — the Teamwork bridge is anticipated
  but barely used.

## The big-picture problem

This is the section where the app's tool-centric shape costs the most. The
business runs on clients; the app runs on tools. Answering "what's the state
of Client X, what did we do last quarter, what's slipping?" currently means
visiting five tools and one browser's localStorage. Meanwhile the entity
that should anchor all of it — `Client` — is already wired to everything.
The data exists; the *view* and the *durability* don't.

## Recommendation

### Phase 1 — Client Command Center ⭐ the highest-leverage UI investment in the app

Rebuild `/clients/[id]` as the de-facto home page of the platform — split
into two deliberate slices so the first ships without waiting on the
findings layer:

**Phase 1a — read-only dashboard from existing data (1.5–2 wks):**
- **Header:** domains, seed URLs, Teamwork link, scheduled-scan status.
- **Scorecards:** latest SEO health score, latest ADA score, pillar score,
  each with sparkline trend and delta since previous run — all computable
  from the scalar columns already on Session/SiteAudit/AdaAudit rows.
- **Activity timeline:** every run/memo/roadmap for this client, any tool,
  reverse-chronological, linking into the tools' detail views.
- **Quarter context:** this client's grid status/priority/notes (Phase 2).
- `/clients` index becomes a fleet table: all ~30 clients × latest scores ×
  alerts — the "Monday morning" screen.

Nothing in 1a requires new data collection — it's assembling what every tool
already stores. That's why it's first.

**Phase 1b — findings/action center (1–1.5 wks, after the relational
findings layer in `06-platform.md`):** open-findings panel across tools,
issue drill-downs, regression alerts from scheduled scans surfacing on the
fleet table.

### Phase 2 — Quarter Grid state into the database (1–1.5 wks)

- Schema: `QuarterPlan` (quarter, startDate, slotsPerWeek, layouts) +
  `QuarterAssignment` (plan, client FK, week, priority, status, note,
  completedAt). One-time importer reads the analyst's localStorage payload
  and writes it to the DB; localStorage demoted to an offline cache at most.
- Payoff: multi-user visibility, survives browsers, queryable history
  ("what did we plan vs complete in Q1"), and the client dashboard can show
  grid status because it's finally in the same database.
- Keep last-write-wins semantics initially (single-team tool); add updatedAt
  conflict warnings only if simultaneous editing actually happens.

### Phase 3 — Quarter Grid component split (1 wk)

Break the 1,215-LOC page into a `useQuarterPlan` data hook (load/save/derive),
grid/pool/chip/layout-manager components, and keyboard handling — currently
zero tests are possible against the monolith; the hook gets unit tests, the
drag logic gets isolated. No behavior change; this is paying down the one
spot in the repo where the code-quality bar visibly dipped.

### Phase 4 — Workflow closure: grid ↔ tools ↔ Teamwork (1–1.5 wks)

The grid says *plan*, the tools say *done* — connect them:

- Completing a client's scheduled scan / roadmap / memo can mark progress on
  their grid assignment for the cycle.
- "Push cycle to Teamwork" via the stored `teamworkTasklistId`: planned-week
  assignments become Teamwork tasks (the er-handoff-memo skill already proves
  the Teamwork integration pattern).
- Cascade-protection: deleting a client currently soft-nulls its sessions —
  with grid state in the DB, deletion should archive, not orphan.

## What I would not do

- Don't normalize `Client.domains` into a child table just for purity; do it
  only if/when domain matching needs an index (it doesn't at 30 clients).
- Don't add real-time multi-user collaboration (CRDTs, presence) to the grid;
  a small team with DB-backed last-write-wins is fine.
- Don't build per-client logins/portals yet. Share links per artifact remain
  the external surface; a client portal is a separate product decision.

## Effort summary

| Phase | Effort | Depends on |
|---|---|---|
| 1a. Client dashboard (scalar MVP) | 1.5–2 wks | — |
| 1b. Findings/action center | 1–1.5 wks | platform findings layer |
| 2. Grid state → DB | 1–1.5 wks | — |
| 3. Grid component split | 1 wk | best after 2 |
| 4. Grid ↔ tools ↔ Teamwork | 1–1.5 wks | 1a + 2 |

Total ≈ 5.5–7.5 weeks. Phase 1a alone changes how the whole app feels: it turns
seven separate tools into one platform with a front door.
