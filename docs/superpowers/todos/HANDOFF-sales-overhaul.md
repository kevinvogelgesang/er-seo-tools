# HANDOFF — Sales-audit overhaul (3-PR series)

**Last updated:** 2026-07-15 — **SERIES COMPLETE. All 3 PRs SHIPPED + DEPLOYED + PROD-VERIFIED.**
**Scope:** a Kevin-commissioned 3-PR series, SEPARATE from the improvement-roadmap (that roadmap's standing direction stays the SF-parity campaign — see `HANDOFF-improvement-roadmap.md`). Do not conflate the two threads.

---

## Series status — DONE

| PR | Title | State |
|----|-------|-------|
| 1 | Explainer inline disclosure component + app-wide adoption | **SHIPPED** (PR #168, main `e330da1`) |
| 2 | Sales report urgency redesign | **SHIPPED** (PR #169, main `99cd885`, prod-verified 2026-07-15) |
| 3 | Prospect scans dashboard UX | **SHIPPED** (PR #170, merge `9dc6e2d`, deployed + prod-verified 2026-07-15) |

There is no PR 4. The series is closed. Next sales/prospect work is a fresh scope, not a continuation of this handoff.

## PR 3 — what shipped (2026-07-15)

On the cookie-gated `/sales` intake (`components/sales/intake/ProspectDashboard.tsx`), each prospect card now has:
- **Real per-prospect progress bar** — phase-labeled (Scanning pages / PDFs / Lighthouse / Building report…) weighted 70/15/15 fraction (`components/sales/intake/progress-math.ts`, pure/client-safe/zero-import; `pagesRedirected` counted as settled per the finalizer; PDF/LH weights reserved until pages drain so the bar is monotone), with a `startedAt`-based ETA (queue wait excluded) on a hydration-safe post-mount 1s render tick that never fetches. Poll/SSE cadence unchanged.
- **Whole-card click-through** (`role="link"`) to the public sales report in a new tab — `opener` nulled by hand (never the `noopener` feature, so the popup-block fallback survives), synchronous `window.open` in the click task, about:blank pre-open + share-mint for tokenless prospects, `pre?.close()` + notice on failure. `closest()` guard + per-button `stopPropagation` keep the nested Copy/Re-scan/Delete controls from activating the card.
- **Prospect scans jump the queue** — ONE shared total ordering in `lib/ada-audit/queue-order.ts` (prospect-owned first → createdAt → id): pure `compareQueuedAudits`, `findNextQueuedAudit()`, `queuedAheadCount()`, and `PROSPECT_DISCOVER_PRIORITY=1`. All four readers adopt it (`processNext`, `getQueueStatus`, `listProspects`, `GET /api/site-audit/[id]`). `processNext` stamps `Job.priority=1` on prospect discover jobs so an already-enqueued unclaimed non-prospect discover job is out-claimed (worker `claimNext` orders `[priority desc, createdAt asc]`). NO preemption; discover claim / recovery / one-active invariant untouched. `listProspects` gained progress counters, `startedAt`, `queuePosition`, and row `salesUrl` (via the extracted single-home `buildProspectSalesUrl`).
- No schema change, no migration, **no new env var** (plain `~/deploy.sh` sufficed).

**Codex P2 fixed in-branch** (`9acec01`): a prospect DELETE `SetNull`s `SiteAudit.prospectId` but left the already-enqueued discover job at the stale `priority=1`, so the worker would out-claim a real prospect's job while every reader classified the orphaned audit as non-prospect. Fix: the delete route (`app/api/sales/prospects/[id]/route.ts`) now demotes (never cancels) any still-queued discover job for the just-orphaned audits back to priority 0.

## PR 3 verification

- Gates (in-session, the ONLY type/test gates — in-build checks disabled): `tsc --noEmit` clean · **574 files / 5361 tests pass** · `next build` exit 0.
- Subagent-driven TDD, 6 tasks; per-task reviews (opus on the queue keystone / loader / component, sonnet elsewhere) — all Approved. Opus whole-branch review: Ready to merge. `/codex-review` (P1, gpt-5.6-sol): 1 P2, fixed.
- Deploy: `~/deploy.sh`, no pending migrations, PM2 `restart` (no env var → no delete+start needed). Autonomous prod-verify PASS: health `ok`, server SHA `9dc6e2d` = main, error log clean (only the benign `[startup] CHROMIUM_NETWORK_ISOLATED` info line), `/sales`→307 gate, `/api/sales/prospects`→401 `auth_required`.

## Open follow-ups (NOT blocking; carried forward for a future session/Kevin)

- **Authenticated live-watch of PR 3** (Kevin, `er_auth` session on `https://seo.erstaging.site`): drive a real prospect scan and eyeball (a) the live progress bar advancing with phase labels + ETA on `/sales`, (b) whole-card click opening the public report in a new tab, (c) a prospect scan jumping ahead of a queued client audit. The autonomous verify above did not exercise the authenticated UI (same posture as PR 1/2's live-watch items).
- **Orphaned curated-screenshot route** (deferred from PR 2, NOT on PR 3's surface): the counts-only redesigned report renders no `/api/sales/[token]/screenshot/...` URL, but that PUBLIC route + `curatedScreenshotSet`/`topPatternIssues`/`loadRepresentativeExamples` remain (ownership + curated-set gated, non-guessable — not a safety regression). Retire/tighten is a security-class change (public route + middleware matcher) deserving its own spec/plan; do NOT fold it into an unrelated PR.
- Hero-route `AUDIT_ID_RE` (`/^[a-z0-9]+$/i`) stricter than `assertSafeId` — inert for cuids, latent divergence (from PR 2).
- InquiryForm is a mailto placeholder — shell structured so a future embedded Jotform swaps behind it (from PR 2).
- PR 3 whole-branch review Minors (all accepted, none blocking): (1) `role="link"` card with nested `<button>` children = ARIA nested-interactive (behavior correct via the guards; internal staff tool) — cleaner would be a non-focusable region + single explicit affordance; (2) clicking a never-scanned card mints a 30-d token + opens the "being prepared" page (matches whole-card intent; consider gating the click to rows with `latestAudit`); (3) `listProspects` sequential `await queuedAheadCount` (rare/small, correct; `Promise.all` possible); (4) PRE-EXISTING: legacy `pending` status absent from the TRANSIENT sets (not introduced here).

---

## Series closed

No paste-in continuation prompt — the 3-PR sales-audit overhaul is complete, shipped, and prod-verified. Start any further sales/prospect work as a new scope (brainstorm → spec → plan), not from this handoff.
