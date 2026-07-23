# Onboarding Viewbook — Tracker

**Roadmap:** `docs/superpowers/nyi/improvement-roadmaps/2026-07-22-onboarding-viewbook-roadmap.md` (read it first — decisions D1–D15 + Codex fixes are pinned there; §9 lists the open Kevin calls; do not re-litigate).
**Cadence:** one session per wave; each session updates this tracker + stages the next handoff (`/handoff-prep`).
**Codex plan:** Codex builds U1, U2, U3, U4, F4 and reviews all specs/plans; 3 usage resets available — on limit, park the Codex lane with a note here, continue Claude-side, re-queue after Kevin resets.
**Dependency spine:** S1 → (U1 ∥ F1) → F2 → F3 → {F4, F5a, U3} → U4 → F5b → F6 → S3. U2 anytime after U1; S2 anytime.

## Status

- [x] **S1. Rename → "Onboarding Viewbook"** (copy-only; first PR, trivial — can ride the first build session, no spec) — SHIPPED + deployed 2026-07-22 (PR #261)
- [ ] **U1. Magic-link auth** (Codex) — DB-backed grants + sessions, per-viewbook cookie, `ViewbookPrincipal` on EVERY token route, SQL rate-limit, member removal. **Before F3.** Parallel with F1/F2. **Spec READY (Codex-reviewed, 12 fixes applied):** `docs/superpowers/specs/2026-07-22-u1-viewbook-magic-link-auth-design.md`
- [ ] **F1. Template library — ADDITIVE** (split CONFIRMED: F1a data/registry/seed/parity + F1b template admin + bridge) — legacy readers stay live; boot-seeder-owned seed; identity contracts per roadmap §4. **Spec READY (Codex-reviewed, 15 fixes applied):** `docs/superpowers/specs/2026-07-22-f1-viewbook-template-library-design.md`. §0 order sign-off CONFIRMED 2026-07-22 — F1a unblocked end-to-end
- [ ] **F2. Viewbook instances + copy-on-create — the CUTOVER** — offerings flags, snapshot-at-create incl. assets, fields become instance-owned, versioned pull-merge, retire legacy stores; test viewbooks wiped
- [ ] **U2. Invite grid** (Codex) — 3 rows + "Add another person"; anytime after U1
- [ ] **F3. Viewer rebuild — stages removed** — DB-order full-width, grey-out + loud checkmark, separator RENDERING + ToC labels, pc-setup → ER options, pcCompletedAt contract, canonical seed order
- [ ] **F4. Subsection completion + rings** (Codex; after F3)
- [ ] **F5a. Inspector nav/layout** (after F3) — outline removed, scroll-spy fix + dropdown, fit-canvas permanent, scroll+flash
- [ ] **U3. Field assignment + quiescence digests** (Codex; after F3) — epoch-fenced race-safe D1 semantics via ViewbookEmailDelivery
- [ ] **U4. Revision inversion** (Codex; after U3) — locks removed, unified history + restore, authorKind/authorNameSnapshot, ER badge
- [ ] **F5b. Content + structural mutation** (after U4) — edit-everything inspector, add/remove/reorder sections + separators, admin parity
- [ ] **F6. Promote-to-template + AI-readiness audit** (roadmap §6 conventions check)
- [ ] **S2. Confetti on milestone checkoff** (canvas-confetti; anytime)
- [ ] **S3. ADA contrast pass** (LAST — after UI stops moving)

## Status log

- 2026-07-22 — **Kevin sign-offs (all 3 open calls closed):** F1 §0 canonical order + seeded subsection titles = recommended set APPROVED (F1a seed/deploy gate cleared); F1 §9 Q1 team roster = uniform copy-on-create frozen + explicit pull APPROVED (F2 spec inherits the decision); U1 §11 break-glass = read-only member-equivalent APPROVED (shapes `canWrite`; acceptance criterion 10 tests as written). Specs annotated in place. Build session 2 (U1 plan→Codex lane ∥ F1a plan→Claude build) proceeding.
- 2026-07-22 — **Build session 1 (S1 + specs):** S1 rename shipped (PR #261: nav/titles/headings/email subjects → "Onboarding Viewbook"; generic mid-sentence "this viewbook" + compact source pills deliberately kept), deployed + prod-verified (health 200, label in built chunk). U1 spec written + Codex-reviewed (Sol, accept w/ 12 fixes — fragment `#g=` links, guarded-INSERT consume txn, atomic request-ledger+delivery, stranger/member cap split, mint-at-send pinned, resolver adapters + sessionId, canWrite capabilities + commit-time member fences, `ViewbookActivity.actorKind`, model completeness, archived-404 + kind-agnostic logout, explicit matcher tail, removal txn + no-store assets) — ALL applied. F1 spec written + Codex-reviewed (Sol, accept w/ 15 fixes — F1b activation reconciliation, single dual-write authority incl. legacy routes, statement-builder extraction, team-photo crash-safe flow, atomic nested-tree seeding, validator extraction to client-safe module, no-code-default correction, library-global immutable fieldKey, subsection copy/content contract, versioned envelopes + legacy translators, CTA→registry, aggregate versions, CATEGORY_LABELS titles + rename into F1a, order decision now BLOCKING, seed-projection parity framing) — ALL applied. **Open Kevin calls:** F1 §0 canonical order + subsection titles (BLOCKS F1a deploy); U1 §11 break-glass read-only rec (confirm before U1 plan); F1 §9 team-freeze rec (by F2 spec). Next session: U1 plan→Codex build lane + F1a plan→build (Claude).
- 2026-07-22 — Roadmap brainstormed + written; decisions D1–D15 pinned with Kevin. Codex review (Sol): accept with 8 named fixes — ALL applied (F1 additive/F2 cutover split, F3/F5 resplit, field-chain dependency F2→F3→U3→U4→F5b, identity/pull/asset contracts, U1 DB-backed auth invariants, U3 epoch fencing, pcCompletedAt + seed-order contracts, audit-roadmap immutability callout). §9 = 6 open Kevin calls at spec time. Sibling audit-actionability roadmap parked NYI. Next: session 1 = S1 + U1 spec + F1 spec (both track heads build against current main; batch-speccing beyond the heads deliberately rejected — drift risk).
