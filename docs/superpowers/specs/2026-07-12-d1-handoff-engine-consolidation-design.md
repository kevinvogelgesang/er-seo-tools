# D1 — Handoff Engine Consolidation (design)

**Date:** 2026-07-12 · **Tracker item:** D1 (Track D) · **Source:**
`../nyi/improvement-roadmaps/03-ai-memo-tools.md` Phase 1 (written when there
were 3 token families; there are now 6).

## Problem

Six skill-handoff token families exist — pat_ (pillar), srt_ (seo-roadmap),
krt_ (keyword-memo), kst_ (keyword-strategy), cat_ (content-audit), qct_
(quarter-push) — and each was built by cloning the previous one: a token
module (`lib/<x>-token.ts`), a prompt composer (`lib/<x>-prompt.ts`), 2–3
public routes with hand-rolled auth, and a UI card. The clones have already
drifted:

- **Scope is minted but never enforced** in 4 of 6 families (pat/srt/krt/qct
  verify issuer/audience/sub only; only kst_/cat_ route-auth helpers check
  scope). A `read`-scoped token wouldn't exist today (mint always grants all
  scopes), but the enforcement seam the scopes were designed for is absent.
- **Two divergent shared helpers**: `lib/keyword-strategy-route-auth.ts`
  (Bearer-only, rich `tokenErrorCode` taxonomy) and
  `lib/content-audit/route-auth.ts` (Bearer-or-`?token=`, flat 401). The
  other four families inline Bearer parsing per route.
- **Style drift**: `content-audit-token.ts` is no-semicolon condensed; kst_
  and cat_ use `withRoute`, the older four hand-roll try/catch; prompt
  composer names/params differ (`composePayload` vs `buildContentAuditPrompt`,
  `webappUrl` vs `appUrl`, string vs number id).
- **Card clones**: SeoRoadmapCard (236 LOC), KeywordMemoCard (231), and
  KeywordStrategyCard (294) are near-identical `createPollingMachine` +
  markdown cards; pillar splits the same shape across MemoPoller (168) +
  PillarAnalysisButtonClient. Every future fix (like A5 PR4's SSE migration)
  is applied 4×.
- The superseded `skills/pillar-analysis-narrative/` directory still sits in
  the repo although `er-handoff-memo` replaced it.

A seventh family (they keep appearing — cat_ and kst_ both landed in the last
month) costs ~a week of plumbing and re-introduces every drift class above.

## Goals

1. One **token factory** — a family is a config entry, not a module.
2. One **route-auth helper** — every public handoff route authenticates the
   same way, *with scope enforcement everywhere* (closing the 4-family gap).
3. One **HANDOFF_TYPES registry** as the single home of per-family config
   (prefix, audience, secret env, scopes, TTL, id label, prompt text parts).
4. One **`<MemoHandoffCard>`** for the four machine-based markdown flows.
5. Delete `skills/pillar-analysis-narrative/`.
6. Net effect: family #7 = registry entry + a GET-export payload builder + a
   PATCH write-back delegate + one card instantiation.

## Non-goals (explicitly out)

- **No wire-contract changes.** Route URLs, middleware `isPublicPath`
  matchers, JWT claims (iss/aud/sub/scope/exp), token prefixes, clipboard
  payload text, and response shapes stay **byte-identical**. The deployed
  er-handoff-memo skill (v2.3.0) is an uncontrolled consumer; its
  `handoff.py` ROUTES table pins all of these.
- **No secret unification.** Per the roadmap doc: unify the code, not the
  keys. kst_/cat_ keep deliberately sharing `KEYWORD_MEMO_TOKEN_SECRET`
  (audience is the isolation wall); the other four keep their own env vars.
  No new env vars, no prod `.env` change.
- **No cat_/qct_ card unification.** ContentAuditCard renders structured
  findings-by-type with a bespoke bounded post-mint poller (A5 PR3 design);
  PushToTeamworkButton is a 63-line fire-and-forget mint button. Forcing
  either into MemoHandoffCard adds modes for negative value. They adopt the
  server-side factory/auth only.
- **No memo-topic re-keying.** `memo:<id>` keying stays exactly as A5 PR4
  shipped it (srt/krt = Session FK, kst = own PK, pat = `sessionId ?? id`).
  The shared-topic cross-family behavior is plan-level accepted design.
- **No changes to `lib/memo-poller-machine.ts`** or `lib/events/*`.
- **No schema migration.**

## Approaches considered

**A. Full unification** — one generic engine absorbing all six families
end-to-end, including cat_'s manifest/page/findings trio, qct_'s receipt
flow, and both outlier cards as render modes. Rejected: the outliers diverge
in *semantics*, not implementation accident (findings JSON vs markdown doc vs
no document at all); a card with three render modes and a route layer with
per-family escape hatches is more code than today, harder to reason about,
and churns surfaces A5 just stabilized.

**B. Layered consolidation (chosen)** — unify the four genuinely-cloned
layers (token, route-auth, prompt composer, markdown-memo card) behind a
registry; keep per-family facade modules so import sites, tests, and wire
contracts don't move; leave family-specific semantics (GET payload builders,
cat_ manifest trio, qct_ receipt, volumes billing) where they are. Full dedup
where the clones are real clones, zero forced abstraction where they aren't.

**C. Server-side only** — factory + route-auth, no card work. Rejected: the
three markdown cards are the highest-drift surface (A5 PR4 had to patch each
one), and the roadmap item names the card explicitly. Halves the value.

## Design (approach B)

### 1. `lib/handoff/registry.ts` — HANDOFF_TYPES

```ts
export type HandoffFamilyKey = 'pat' | 'srt' | 'krt' | 'kst' | 'cat' | 'qct'

export interface HandoffFamilyConfig {
  prefix: string            // 'pat_' … literal, never derived
  audience: string          // existing literal, e.g. 'pillar-analysis-narrative'
  secretEnv: string         // 'PILLAR_TOKEN_SECRET' | … | 'KEYWORD_MEMO_TOKEN_SECRET' (shared ×2)
  scopes: readonly string[] // full grant minted on every token (unchanged)
  ttlSeconds: number        // 3600 for all six today
  idLabel: string           // 'Analysis ID' | 'Roadmap ID' | … (clipboard contract)
}

export const HANDOFF_TYPES: Record<HandoffFamilyKey, HandoffFamilyConfig>
```

All values are copied **literally** from the six existing modules (registry
values are wire contract; a test pins each against the legacy literals).
Client-safe: no secrets, no node imports — cards may import `idLabel` etc.

### 2. `lib/handoff/token.ts` — the factory

`createHandoffTokenFamily(config: HandoffFamilyConfig)` returns
`{ mint(id): Promise<MintedToken>, verify(token, expectedId): Promise<JWTPayload> }`
implementing exactly the shared behavior of the six current modules:

- jose HS256, `iss 'er-seo-tools'`, `aud config.audience`, `sub id`,
  `scope: config.scopes`, expiry `config.ttlSeconds`.
- Secret resolution from `process.env[config.secretEnv]`; production throw
  when unset; dev fallback secret with a **per-family warn-once** flag
  (current behavior, preserved).
- One shared `HandoffTokenError` class. The existing per-family error classes
  become subclasses re-exported from the facades, so any `instanceof` checks
  and error-name expectations in routes/tests keep passing.
- Verify checks signature/iss/aud/exp and `sub === expectedId` — same checks
  as today, no more, no fewer (scope stays a route-layer concern).

**Facades:** the six existing modules (`lib/pillar-token.ts` etc.) shrink to
config lookup + re-export with their current exported names
(`mintPillarToken`, `verifySeoRoadmapToken`, `KEYWORD_STRATEGY_TOKEN_SCOPES`,
`CONTENT_AUDIT_TOKEN_TTL_MS`, pat_'s `parsePillarPrompt` + regexes, …). No
import site anywhere else changes. Existing per-module tests keep running
against the facades — they become the byte-compat regression net.

### 3. `lib/handoff/route-auth.ts` — one auth helper

`requireHandoffToken(req, family, expectedId, requiredScope, opts?)` →
`{ ok: true, payload } | { ok: false, response: 401 }` — fail-closed, never
throws raw (cat_ helper's contract, generalized):

- Token extraction: `Authorization: Bearer <prefix_…>` for all families;
  `opts.allowQueryToken` adds cat_'s `?token=` fallback (cat_ only).
- Verifies via the factory family, then **enforces `requiredScope` for every
  family** — new enforcement for pat/srt/krt/qct. Strictly tightening and
  runtime-safe: mint has always granted the full scope set and TTL is 1 h, so
  no live token lacks the scopes.
- Error taxonomy: kst_'s rich `tokenErrorCode` mapping becomes the shared
  behavior **only where kst_ already returns it**; the other five keep their
  current (flat 401) response bodies. Response-shape parity per family is
  test-pinned before the switch (characterization tests first, then adopt).

The two existing helpers (`keyword-strategy-route-auth.ts`,
`content-audit/route-auth.ts`) become facades delegating here (signatures
unchanged), so kst_/cat_ routes don't churn.

Adoption: the 8 inline-auth public routes (pat/srt/krt GET+PATCH, qct
GET+POST) switch to the helper via their family facade. Route URLs, methods,
success bodies: untouched. `middleware.ts`: untouched (drift test already
pins the matcher set).

### 4. Prompt composer consolidation

`lib/handoff/prompt.ts` — `composeHandoffPayload(family, { webappUrl, id,
token, … })` produces the 3-line contract (`Webapp:` / `<idLabel>:` /
`Access token:`) + per-family instruction lines sourced from the registry.
The six existing composer functions become facades with **byte-identical
output** — each facade's existing test (they're already string-pinned) is the
gate. cat_'s `buildContentAuditPrompt({appUrl,…})` and qct_'s numeric-id
signature are preserved at the facade.

### 5. Markdown write-back delegate (server)

The four document PATCH routes (pat narrative, srt roadmap, krt memo, kst
memo) share a shape: validate body (markdown + optional structured) → update
one row (columns differ) → stamp updatedAt → emit `memoTopic(<row key>)` off
the **returned row**. Extract `lib/handoff/document-writeback.ts`:

```ts
handleDocumentWriteBack(req, {
  family, id,
  update(body): Promise<{ topicId: string }>,   // family-owned prisma update, returns row-derived topic id
  // validation limits per family stay as today (characterization-pinned)
})
```

Route files remain (App Router filesystem requirement) as thin delegations:
auth via §3, then the family's `update` closure. **Emit stays post-resolve,
outside any tx, keyed off the returned row's FK — the A5 invariants — now
encoded once instead of four times.** The A5 emit-identity tests
(`not.toHaveBeenCalledWith(<wrongId>)`) keep passing unchanged.

GET export routes are *not* genericized beyond auth: their payload builders
are the actual per-family product surface. cat_'s manifest/page/findings and
kst_'s volumes route keep their current handlers (auth facade only).

### 6. `components/handoff/MemoHandoffCard.tsx` — one card

Generalizes the three clone cards + MemoPoller. Props (approximate):

```ts
{
  family: HandoffFamilyKey            // idLabel + prompt text from registry
  mintUrl: string                     // cookie-gated mint endpoint
  pollUrl: string                     // cookie-gated poll endpoint
  topicId: string                     // memoTopic key (family-correct id, caller-supplied)
  initial: { status, memoMarkdown, updatedAt, … }
  renderMemo: (markdown: string) => ReactNode   // RoadmapMarkdown / KeywordMemoMarkdown / pillar markdown
  labels?: { title, buttonIdle, … }
}
```

Internals: exactly the shipped A5 PR4 topology — `createPollingMachine` with
`lifetimeMs` cap, SSE via `subscribeTopic(memoTopic(topicId))` routed through
`machine.invalidate()` (never bypassing cap/visibility/backoff), health-gated
cadence (fast until SSE connected+healthy, then `SAFETY_POLL_MEMO_MS` 20 s,
re-arm fast on error/watchdog), clipboard mint flow, expired-never-resurrected.
The A5 component-test suites for the three cards are ported to the shared
card once + a thin per-adoption smoke each (renders, correct poll URL, correct
topic).

Adoptions (behavior-preserving, one card at a time):
- `SeoRoadmapCard` → instance with `renderMemo={RoadmapMarkdown}`.
- `KeywordMemoCard` → instance with `renderMemo={KeywordMemoMarkdown}`.
- `KeywordStrategyCard` → instance (keeps `KeywordMemoMarkdown` reuse,
  regenerate-anchors-baseline-to-null behavior, `Strategy ID:` label). Its
  vestigial SSE-handler pre-fetch (recorded A5 follow-up) dies here.
- Pillar `MemoPoller` → instance. `PillarAnalysisButtonClient` is NOT a memo
  card (it tracks analysis status on `pillarAnalysisTopic`) — untouched.

Divergences between the cards (kst_'s profile-refetch on change, per-card
titles/CTAs, srt/krt structured sidecars) ride the props; anything that
doesn't fit a prop cleanly stays in the family wrapper component — the
wrapper owns *what*, the shared card owns *how to mint/poll/render*.

UI-class gates apply: every element keeps its dark-mode variants; no
hydration-mismatch patterns (cards are client components fed serialized
initial state — same as today).

### 7. Legacy skill deletion

`git rm -r skills/pillar-analysis-narrative/` after verifying nothing
imports/references the *directory* (the audience string literal
`'pillar-analysis-narrative'` is a frozen wire value that stays). The
er-handoff-memo skill's pat_ branch is the replacement and has been in
production use.

## Security notes (security-sensitive class)

- Token verification changes are behavior-preserving by construction
  (characterization tests pin per-family verify semantics before the swap).
- Scope enforcement is added, never removed — strictly fail-closed tightening.
- `middleware.ts` is not modified; the existing matcher drift test plus
  `middleware.test.ts` stay the gate.
- No secret material moves; no new env vars; `?token=` acceptance stays
  cat_-only (never generalized).
- audit-ci gate must stay green.

## Testing strategy

1. **Characterization first**: before any route/module switches, pin current
   behavior — per-family token claims (existing tests already do), prompt
   composer exact strings (existing), and public-route auth responses
   (200/401 bodies per family; add where missing).
2. Factory/registry/route-auth unit tests (shared behavior + per-family
   config-literal pinning + scope-enforcement cases).
3. Card: port the A5 SSE behavior suites onto MemoHandoffCard (invalidate
   while visible/hidden, 20 s safety cadence, expired-no-resurrect, machine
   never bypassed) + per-adoption smokes.
4. Gates: `tsc --noEmit` + full vitest + build; **`npm run smoke`** for the
   PR touching pillar surfaces (PillarAnalysisButtonClient/MemoPoller render
   on the smoke-walked results page — PR4 precedent) — and it walks auth.

## PR structure

- **PR 1 (server):** registry + token factory + route-auth + prompt facades +
  document-writeback delegate + 8-route adoption + legacy skill deletion.
  No UI changes. Gate-green + smoke.
- **PR 2 (client):** MemoHandoffCard + 4 adoptions (SeoRoadmap, KeywordMemo,
  KeywordStrategy, MemoPoller). Gate-green + smoke.

Deploys per rule 1 (autonomous when gate-green, post-deploy verify: health,
one public GET 401s cookie-less without a token, prompt payload unchanged on
a real mint, prefix/topic literals intact in minified chunks).

Note on A5: Kevin's live watches are still pending. PR 2 rewrites the memo
cards' internals while preserving the A5 topology; if the watches haven't
happened by PR 2 merge time, prod behavior stays equivalent (the watches
verify the *topology*, which is unchanged), but the session will call this
out so Kevin can sequence his watch before or after at his choice.

## Success criteria

- All six families mint/verify/compose through `lib/handoff/` with zero wire
  drift (facade tests green untouched).
- Scope enforced on all public handoff routes.
- 3 clone cards + MemoPoller replaced by one tested card + thin wrappers.
- `skills/pillar-analysis-narrative/` gone.
- A dry-run doc section: "adding family #7" enumerating the (short) checklist
  it now takes — registry entry, mint/poll routes, GET builder, PATCH
  delegate closure, card instance, middleware matchers + tests.
