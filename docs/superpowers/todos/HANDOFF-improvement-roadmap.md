# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-07 (**Kevin pivoted from A8 per-tool polish to C11. C11 PR 1 — SEO-only scan mode + URL scan form — spec + plan WRITTEN and Codex-reviewed (both ACCEPT WITH NAMED FIXES, all applied), committed on branch `feat/c11-pr1-seo-only-scan` (worktree `.claude/worktrees/c11-pr1`). Next action = EXECUTE the C11 PR 1 plan.**) · **Updated by:** the C11 PR 1 spec/plan session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap: EXECUTE C11 PR 1 — SEO-only scan mode +
URL scan form. The spec + plan are already WRITTEN and Codex-reviewed (both ACCEPT WITH
NAMED FIXES, all fixes applied) and committed on branch `feat/c11-pr1-seo-only-scan`
(worktree `.claude/worktrees/c11-pr1`, branched off origin/main). Do NOT re-brainstorm or
re-plan — go straight to implementation.

- Spec: docs/superpowers/specs/2026-07-07-seo-only-scan-mode-design.md
- Plan: docs/superpowers/plans/2026-07-07-seo-only-scan-mode.md  (11 TDD tasks)

WHAT C11 PR 1 IS: a render-only `seoOnly` site-audit mode (navigate + settle + harvest
links/on-page-SEO; SKIP axe + screenshots + PDF dispatch + PSI) + a URL scan form on
/seo-parser that triggers it. ~4x cheaper than the paired ADA pipeline. Results surface as
the existing "live-scan" CrawlRun at /seo-parser/results/run/[runId]. This is the tracker's
C11 (line 452); PR 2 = toggles/visibility, PR 3 = /seo-parser→/seo-audits rename+maturation
(both OUT of PR 1).

LOCKED DESIGN DECISIONS (Codex-adjudicated — do not relitigate):
- New independent `SiteAudit.seoOnly Boolean @default(false)` column; enforce seoOnly⇒seoIntent
  at enqueue (queueSiteAuditRequest). NOT a scanMode enum.
- On-demand URL form ONLY; scheduled scans stay full-pipeline (the 2nd // FUTURE breadcrumb
  is NOT touched in PR 1).
- Page job reads seoOnly off the PARENT SiteAudit row (authoritative), not the payload.
- Runner gets a `renderOnly` option → distinct `kind:'rendered'` result (skip axe +
  screenshots + BOTH Lighthouse paths, keep nav/settle/harvest).
- CRITICAL INVARIANT: a seoOnly audit must produce NO `tool:'ada-audit'` CrawlRun, NO ADA
  summary, NO carry-forward (ADA report/csv/vpat routes gate purely on the ada run existing —
  an empty one would look valid). Finalizer keeps enqueueBrokenLinkVerify (the live-scan
  builder) for both modes.
- Form on /seo-parser with a minimal pending-status card (queued/running → "building SEO
  report" → ready link). Readiness signal = add `liveScanRunId` to GET /api/site-audit/[id]
  (select crawlRun where tool:'seo-parser'). Never route a seoOnly audit to /ada-audit/site/[id].
- ADA-surface guards (share route reject, quick-widget 409 mode-aware, /ada-audit/site/[id]
  redirect, list/queue/dashboard exclude-or-label). Recovery covers zero-harvest seoOnly.

1. Load skill er-seo-tools-change-control first. Gate policy (rules 1 & 4): THIS PASTED
   PROMPT is standing authorization to merge the gate-green C11 PR 1 at session end
   (re-run lint/test/build on the branch this session first) and to deploy when needed,
   ALWAYS followed by post-deploy verify. Destructive server ops stay Kevin-gated; docs
   rituals mandatory; NEVER scan non-client sites (PR 1 adds a URL scan form — dev-test it
   ONLY against a client domain already in the system or a domain you control).
2. Trust ranking when docs disagree: code > plan/spec > tracker/handoff.
3. Execute the plan task-by-task via superpowers:subagent-driven-development (fresh subagent
   per task + two-stage review) in the existing worktree `.claude/worktrees/c11-pr1`. The
   plan's tasks are already TDD (failing test → impl → pass → commit). Migration note:
   `prisma migrate dev` is interactive-only here — author migration.sql by hand + apply with
   `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … prisma generate` (plan
   Task 1 Step 3b/3c).
4. Gates before PR: npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test +
   npm run build. UI class (the SeoScanForm): dark: on every element; no hydration mismatch;
   any NEW Tailwind class must be reachable by the content globs (./lib/** already included).
   Then PR → merge → ~/deploy.sh (a migration deploys automatically) → post-deploy verify.
   POST-DEPLOY VERIFY MUST drive the real authed page in Playwright: submit a seoOnly scan
   for a CLIENT domain at https://seo.erstaging.site/seo-parser, watch the pending card flip
   to a live-scan result, and confirm NO ada-audit run / ADA exports 409. Server-side health
   is not enough.
5. Docs ritual: tracker checkbox/status-log + rewrite this handoff in the same commit as the
   ship. On ship, move spec + plan to docs/superpowers/archive/. C11 stays [ ] until all 3
   PRs land (tick PR 1 in the status log). A8 stays [~] (paused mid per-tool polish — the
   NEXT A8 pass is PR 5 = ada-audit visual polish; resume it after C11 unless Kevin redirects).
```

## Current state (2026-07-07)

- **C11 (active, [ ]) — SEO Audits v1. PR 1 (seoOnly + URL form) spec+plan DONE, ready to build:**
  - Brainstormed with Kevin (chose PR 1 as the entry point of the 3-PR arc). Design
    decisions + spec + plan all Codex-reviewed (fresh session `019f3f3e…` in the c11-pr1
    workspace): design ruling, spec review (8 fixes), plan review (9 fixes) — all applied.
  - **Spec** `specs/2026-07-07-seo-only-scan-mode-design.md`, **plan**
    `plans/2026-07-07-seo-only-scan-mode.md` (11 TDD tasks), committed on
    `feat/c11-pr1-seo-only-scan` (`e4268ae`, `97206a0`).
  - Verified code seams (Explore + Codex, on origin/main): enqueue chain
    route→queueSiteAuditRequest→enqueueAudit; page job `site-audit-page.ts` (runAxeAudit is
    the axe+screenshot+harvest call; PDF at L268; PSI branch L275-283; claim-0 repair L216);
    finalizer `site-audit-finalizer.ts` (drain L50-52 — zero pdf/lighthouse totals drain
    naturally; ADA summary L79, carry-forward L105, ada dual-write L112-130, verify L136);
    runner `RunAxeResult` union (`kind:'audited'|'redirected'`); ADA exports 409 on missing
    ada run (report/csv/vpat); QuickSiteAuditWidget routes 202+409 to /ada-audit/site;
    share route gates only on status; `StatusPill` tones neutral|running|success|error|warning;
    batch routes at `app/api/audit-batches/*`.
  - **Next:** execute the plan (subagent-driven) → PR → merge → deploy → prod-verify (real
    authed Playwright submit of a client-domain seoOnly scan) → tracker+handoff ritual → move
    spec/plan to archive/. Then PR 2 (toggles/visibility) and PR 3 (rename/maturation).

- **A8 (active, [~]) — PAUSED mid per-tool polish (Kevin pivoted to C11 on 2026-07-07).**
  Homepage/shell system COMPLETE through PR 3.5. Per-tool polish: **PR 4 (seo-parser) SHIPPED
  + PROD-VERIFIED (PR #120)**; the next A8 pass is **PR 5 = ada-audit visual polish**
  (VISUAL-ONLY; watch the public share views `/ada-audit/share`, `/ada-audit/site/share`
  which render OUTSIDE the shell — a shared component can't have its min-h-screen/bg wrapper
  stripped). Resume A8 PR 5 after C11 unless Kevin redirects. PR-4 recipe + tokens
  (navy #1c2d4a, orange #f5a623, navy-deep #0f1d30; opacity `bg-navy/[0.08]` not `/8`) and the
  "measure widths in Playwright" verify lesson still apply. A8 stays [~]; mark [x] only when
  Kevin calls A8 done.

- **Everything else** (Tracks A–D, C6 SF-retirement, C10 reports): unchanged — see the
  tracker (`2026-06-10-improvement-roadmap-tracker.md`) for authoritative per-item status
  and the full status log.
