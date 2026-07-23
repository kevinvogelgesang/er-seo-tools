# Onboarding Viewbook — Tracker

**Roadmap:** `docs/superpowers/nyi/improvement-roadmaps/2026-07-22-onboarding-viewbook-roadmap.md` (read it first — decisions D1–D15 + Codex fixes are pinned there; §9 lists the open Kevin calls; do not re-litigate).
**Cadence:** one session per wave; each session updates this tracker + stages the next handoff (`/handoff-prep`).
**Codex plan:** Codex builds U1, U2, U3, U4, F4 and reviews all specs/plans; 3 usage resets available — on limit, park the Codex lane with a note here, continue Claude-side, re-queue after Kevin resets.
**Dependency spine:** S1 → (U1 ∥ F1) → F2 → F3 → {F4, F5a, U3} → U4 → F5b → F6 → S3. U2 anytime after U1; S2 anytime.

## Status

- [ ] **S1. Rename → "Onboarding Viewbook"** (copy-only; first PR, trivial — can ride the first build session, no spec)
- [ ] **U1. Magic-link auth** (Codex) — DB-backed grants + sessions, per-viewbook cookie, `ViewbookPrincipal` on EVERY token route, SQL rate-limit, member removal. **Before F3.** Parallel with F1/F2.
- [ ] **F1. Template library — ADDITIVE** (split F1a data/registry/migration-seed + F1b template admin if spec confirms) — legacy readers stay live; migration-owned seed; identity contracts per roadmap §4
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

- 2026-07-22 — Roadmap brainstormed + written; decisions D1–D15 pinned with Kevin. Codex review (Sol): accept with 8 named fixes — ALL applied (F1 additive/F2 cutover split, F3/F5 resplit, field-chain dependency F2→F3→U3→U4→F5b, identity/pull/asset contracts, U1 DB-backed auth invariants, U3 epoch fencing, pcCompletedAt + seed-order contracts, audit-roadmap immutability callout). §9 = 6 open Kevin calls at spec time. Sibling audit-actionability roadmap parked NYI. Next: session 1 = S1 + U1 spec + F1 spec (both track heads build against current main; batch-speccing beyond the heads deliberately rejected — drift risk).
