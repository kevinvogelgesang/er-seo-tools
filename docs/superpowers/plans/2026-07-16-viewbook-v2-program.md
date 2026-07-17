# Viewbook v2 Program — Waves, Lanes & Coordination

**Spec:** `docs/superpowers/specs/2026-07-16-viewbook-v2-stages-design.md`
(Codex-reviewed, 12 fixes applied). 8 PRs, Claude + Codex tandem — the v1
viewbook tandem model (PRs #185–#192) reused.

## Wave plan

PR numbers are the spec §15 increments. Waves run left-to-right; PRs inside a
wave run concurrently in separate worktrees with disjoint file ownership.

| Wave | Claude lane | Codex lane | Gate to start |
|---|---|---|---|
| 1 | **PR1** Stage engine core (schema/migration, stage catalog, lineups, stage-move) | — (idle; briefs not yet cuttable) | spec merged |
| 2 | **PR2** Live sync (syncVersion bumps, sync endpoints, `useViewbookSync`) | **PR4** Kickoff + docs (`ViewbookDoc`, PDF pipeline, doc cards, kickoff-next CTA, public-page session helper) | PR1 merged |
| 3 | **PR6** Website-specifics (ws-intro, WCAG tester, `contrast.ts`, luminance refactor) | **PR3** Email infra + CSM (`viewbook-email` job, delivery fencing, templates, roster isCsm/email, CSM card, stage-change wiring) | wave 2 merged |
| 4 | **PR5** Post-contract stage (pc sections, team invites, ack + completion, public routes, ack-to-stage fence, creation default flip, **admin stage-move buttons** — deferred here from PR1 so the UI never exposes moves into stages whose components don't exist yet) | **PR8** ER inline layer (inline controls, presentation toggle — consumes PR4's session helper) | wave 3 merged |
| 5 | **PR7** Design pass (SectionShell v2, header, TOC rail, search, SVG accents, sharp/webp) — via frontend-design skill | — | wave 4 merged |

Ordering rationale (spec Codex fix 2): email infrastructure (PR3) and CSM
land before anything that can trigger a send (PR5); creation default stays
`building` until PR5 flips it; PR7 runs last so the visual pass restyles the
FINAL section set once, with no concurrent structural edits.

## Session cadence (Kevin, 2026-07-16)

ONE session per wave. Claude finishes its PR, waits for the Codex-lane PR to
land too (either order), then writes the wave handoff (tracker line, HANDOFF
doc, "paste into a new chat" prompt) and STOPS — no next-wave plans, briefs,
worktrees, or dispatches in the same session. The handoff prompt includes the
instructions to cut and launch Codex's next-wave brief, so the fresh session
starts both lanes.

## Lane rules (v1 lessons, verbatim)

- **Briefs are cut from MERGED code, never memory.** Each Codex brief is
  written just-in-time when its wave opens, referencing the then-current
  `main`. Same for Claude PR plans beyond PR1.
- Codex works in a worktree under `.claude/worktrees/<slug>`; `codex exec`
  there **cannot commit or network** — Codex leaves work uncommitted, Claude
  runs gates (`tsc --noEmit`, `npm run lint`, `DATABASE_URL="file:./local-dev.db" npm test`,
  `npm run build`) and commits.
- `codex exec resume` takes `-c sandbox_mode=` (not `--sandbox`); pin the
  model each call. Sol High while the 5h window has >25% remaining; on budget
  exhaustion **PAUSE the lane and tell Kevin** (he triggers his reset) —
  never takeover.
- **Cross-review both directions before every merge:** Codex-lane work is
  reviewed by Claude before commit; Claude-lane PRs get `/codex-review`
  (P1) before merge.
- One PR = one branch = one worktree. Never edit in the main checkout while
  lanes are open (other sessions run there).
- **Program-wide sync-bump rule (Codex plan-review fix 4):** every PR after
  PR2 that introduces a mutation of rendered viewbook data (PR3 CSM/global
  content/stage deliveries, PR4 docs, PR5 ack/team/setup, PR7 asset writes)
  MUST consume PR2's exported `syncVersionBumpStatement()` inside the same
  fenced transaction AND add bump/no-bump tests (0-row fenced write and
  idempotent replay bump NOTHING). This is a merge gate, not a rebase note.

## File-ownership map (conflict fences per concurrent wave)

**Wave 2** — PR2 owns: `lib/viewbook/answers.ts`, `lib/viewbook/public-writes.ts`,
`lib/viewbook/global-content.ts` (txn-ification + bumps), `lib/viewbook/service.ts`
(bump statements only), `app/api/viewbook/[token]/sync/`, `app/api/viewbooks/[id]/sync/`,
`components/viewbook/public/useViewbookSync.ts` + editor-registry touches to the
four v1 islands, `middleware.ts` (sync matcher). PR4 owns: `lib/viewbook/docs.ts`
(new), `lib/viewbook/assets.ts` (PDF sniff/caps section), `lib/viewbook/public-session.ts`
(new helper), `app/api/viewbook-docs/**`, `app/api/viewbooks/[id]/docs/**`,
`app/api/viewbook/[token]/assets/[filename]/route.ts` (allowlist extension),
`components/viewbook/public/StrategySection.tsx`, `components/viewbook/public/KickoffNextSection.tsx`
(new), admin docs UI. **NOT disjoint (Codex plan-review fix 3):** both PRs
touch `lib/viewbook/public-data.ts`, `lib/viewbook/public-types.ts`, and the
public page/shell. **Merge order inside wave 2: PR2 first; PR4 rebases and
OWNS the integration edits** to those shared files (and adopts
`syncVersionBumpStatement()` for its doc-write transactions) before merge.
Concurrent work stays on leaf files until the rebase.

**Wave 3** — PR6 owns: `lib/viewbook/contrast.ts` (new), `lib/viewbook/theme.ts`
(luminance refactor), `components/viewbook/public/WsIntroSection.tsx` +
`ContrastTester.tsx` (new), `components/viewbook/public/BrandSection.tsx`
(tester composition), `lib/viewbook/stages.ts` (ws-intro lineup activation) +
`app/(public)/viewbook/[token]/page.tsx` (ws-intro renderSection case)
(Codex wave-3 fix 5 — these two were omitted from the original map; PR3 touches
neither, so the lane stays disjoint). PR3 owns:
`lib/viewbook/email.ts` (new delivery core + shared recovery seam),
`lib/jobs/handlers/viewbook-email.ts` (new),
`lib/notify/viewbook-email-content.ts` (new templates),
`lib/viewbook/global-content.ts`/`global-content-keys.ts` (roster isCsm/email +
shared `canonicalMailbox`/`PRIMARY_CONTACT_EMAIL_DEFKEY`),
`lib/viewbook/service.ts` (CSM assignment + stage-move delivery wiring),
`lib/jobs/handlers/register.ts` + recovery seams (`recoverQueue`/stale-audit-reset
wiring), `components/viewbook/public/WelcomeSection.tsx` (CSM card),
`components/viewbook/admin/GlobalContentEditor.tsx` (roster email/isCsm inputs +
CSM picker). **Wave 3 is disjoint — no shared files, no rebase-integration duty
(either merge order works).**

**Wave 4** — PR5 owns: `lib/viewbook/stages.ts` (lineup additions, PC defkeys),
`lib/viewbook/catalog.ts` (phone/website entries), `lib/viewbook/team-members.ts` +
`lib/viewbook/ack.ts` (new), the three public routes + matchers
(`middleware.ts`), pc-* section components, creation-default flip in
`service.ts`. PR8 owns: `components/viewbook/public/OperatorLayer/**` (new),
`components/viewbook/public/PresentationToggle.tsx` (new), per-section
affordance slots, `app/(public)/viewbook/[token]/page.tsx` (session wiring
via PR4's helper). **NOT disjoint (fix 3):** both touch the public page and
section components. **Merge order: PR5 first; PR8 rebases and OWNS the final
page/session integration.** PR8 adds affordance slots only via a wrapper,
never edits pc-* files. PR5 also picks up the admin stage-move buttons
deferred from PR1 (fix 6).

## Deploy plan

- Additive migration lands with PR1; deploy is optional per wave — minimum:
  one deploy after wave 2 (schema + sync live for smoke) and one after wave 5.
- `sharp` (PR7): direct dependency; prod `npm install` pulls prebuilt
  binaries; profile decode at max dimensions on the box before merge
  (spec §9); no new env vars anywhere in the program.
- The prod smoke viewbook (id 1) migrates to `building` — verify post-deploy
  that its public page renders identically (v1 parity) after PR1's deploy.

## Tracker & handoff

Program-level status lives in this doc's checklist (below). The roadmap
tracker gets a status-log line per merged wave (change-control ritual).

- [x] Wave 1: PR1 merged (#195, merge a7f6b53, 2026-07-16 — gates 5735/5735 + build; Codex review P2 font-scope finding fixed)
- [x] Wave 2: PR2 + PR4 merged (PR #196 `f533465` + PR #197 `1964ff7`, 2026-07-16 — final gates 5832/5832 + build; PR2 had two review-driven fix waves incl. an empirically-reproduced latch-deadlock Critical; PR4 Codex-implemented, Claude cross-reviewed, rebased + sync-integrated)
- [x] Wave 3: PR6 + PR3 merged (PR #198 `8672a98` website-specifics + PR #199 `5017128` email+CSM, 2026-07-16 — disjoint lanes; PR6 gates 5852 + build, PR3 gates 5885 + build; PR6 Codex P2 dark-variants fixed; PR3 cross-review 2 Important + Codex 3 P2 fixed)
- [ ] Wave 4: PR5 + PR8 merged
- [ ] Wave 5: PR7 merged
- [ ] Prod deploy + spec-§13 verification pass
