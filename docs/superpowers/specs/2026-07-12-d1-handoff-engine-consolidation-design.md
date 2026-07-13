# D1 — Handoff Engine Consolidation (design)

**Date:** 2026-07-12 · **Tracker item:** D1 (Track D) · **Source:**
`../nyi/improvement-roadmaps/03-ai-memo-tools.md` Phase 1 (written when there
were 3 token families; there are now 6). **Codex review 2026-07-12:
ACCEPT WITH NAMED FIXES ×8 — all applied in this revision** (the original
draft's scope-enforcement premise was factually wrong; corrected throughout).
**Revision 2 (same day, pre-plan code reading):** §5 emit-wrapper dropped
(the emit is already a one-line shared call; nothing to extract) and §6
recast as poller-hook + one shared card (the four cards split into two
data-flow shapes; the quadruplicated unit is the wiring, not the render).

## Problem

Six skill-handoff token families exist — pat_ (pillar), srt_ (seo-roadmap),
krt_ (keyword-memo), kst_ (keyword-strategy), cat_ (content-audit), qct_
(quarter-push) — and each was built by cloning the previous one: a token
module (`lib/<x>-token.ts`), a prompt composer (`lib/<x>-prompt.ts`), 2–3
public routes with per-route auth, and a UI card. The clones have drifted in
*implementation*, and every behavior — including the drift — is wire contract
for the deployed er-handoff-memo skill:

- **Auth is hand-cloned per route with divergent error taxonomies.** All six
  families enforce scope, but each spells its rejections differently:
  srt/krt return `auth_missing` / `auth_malformed` / `token_missing_scope` /
  `token_service_unavailable`; qct collapses to `auth_missing_or_malformed`;
  pat_ message-sniffs `PillarTokenError` into `token_expired` /
  `token_wrong_analysis_id` / `token_invalid_signature` / `token_invalid`;
  kst_ has its own rich `tokenErrorCode` taxonomy; cat_ deliberately
  collapses everything to `auth_required` / `insufficient_scope` and is the
  only family accepting `?token=` as a Bearer fallback. Six hand-rolled
  copies of "the same" check is a drift/regression risk every time one is
  touched — the fix is centralizing the *mechanism* while preserving each
  family's response contract byte-for-byte.
- **Two divergent shared helpers already exist**:
  `lib/keyword-strategy-route-auth.ts` (Bearer-only) and
  `lib/content-audit/route-auth.ts` (Bearer-or-`?token=`); the other four
  families inline.
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
  the repo (with live build wiring: `scripts/build-skill.sh` +
  `npm run build:skill`) although `er-handoff-memo` replaced it.

A seventh family (they keep appearing — cat_ and kst_ both landed in the last
month) costs ~a week of plumbing and re-introduces every drift class above.

## Goals

1. One **token factory** — a family is a config entry, not a module.
2. One **route-auth helper** that centralizes the existing verification +
   scope enforcement mechanism with **zero behavioral change** — each
   family's error codes, statuses, and transport rules are preserved exactly
   via per-family response policy.
3. One **HANDOFF_TYPES registry**, split into a server-only token registry
   and a client-safe metadata registry.
4. One **`<MemoHandoffCard>`** for the four machine-based markdown flows.
5. Delete `skills/pillar-analysis-narrative/` + its build wiring.
6. Net effect: family #7 = registry entries + a GET-export payload builder +
   a PATCH write-back delegate + one card instantiation.

## Non-goals (explicitly out)

- **No wire-contract changes.** Route URLs, middleware `isPublicPath`
  matchers, JWT claims (iss/aud/sub/scope/exp), token prefixes, clipboard
  payload text, **per-family auth error codes/statuses**, and success
  response shapes stay **byte-identical**. The deployed er-handoff-memo
  skill (v2.3.0) is an uncontrolled consumer; its `handoff.py` ROUTES table
  and error diagnostics pin all of these. Explicitly rejected: normalizing
  the six error taxonomies into one (cleaner internally, but a frozen-wire
  violation).
- **No secret unification.** kst_/cat_ keep deliberately sharing
  `KEYWORD_MEMO_TOKEN_SECRET` (audience is the isolation wall); the other
  four keep their own env vars. No new env vars, no prod `.env` change.
- **No security-behavior deltas.** Scope enforcement already exists on all
  six families; this work centralizes it, it does not add or remove checks.
  `?token=` acceptance stays cat_-only.
- **No cat_/qct_ card unification.** ContentAuditCard renders structured
  findings-by-type with a bespoke bounded post-mint poller (A5 PR3 design);
  PushToTeamworkButton is a 63-line fire-and-forget mint button. They adopt
  the server-side factory/auth only.
- **No memo-topic re-keying.** `memo:<id>` keying stays exactly as A5 PR4
  shipped it (srt/krt = Session FK, kst = own PK, pat = `sessionId ?? id`).
- **No changes to `lib/memo-poller-machine.ts`** or `lib/events/*`.
- **No schema migration.**

## Approaches considered

**A. Full unification** — one generic engine absorbing all six families
end-to-end, including cat_'s manifest/page/findings trio, qct_'s receipt
flow, and both outlier cards as render modes. Rejected: the outliers diverge
in *semantics*, not implementation accident.

**B. Layered consolidation (chosen)** — unify the four genuinely-cloned
layers (token, route-auth mechanism, prompt composer, markdown-memo card)
behind a registry; keep per-family facade modules so import sites, tests,
and wire contracts don't move; represent family differences **explicitly as
registry policy** rather than treating them as incidental; leave
family-specific semantics (GET payload builders, cat_ manifest trio, qct_
receipt, volumes billing) where they are.

**C. Server-side only** — factory + route-auth, no card work. Rejected: the
markdown cards are the highest-drift surface (A5 PR4 had to patch each one),
and the roadmap item names the card explicitly.

## Design (approach B)

### 1. Registries — server/client split

**`lib/handoff/registry.ts` (server-only):** per-family token + auth policy.

```ts
export type HandoffFamilyKey = 'pat' | 'srt' | 'krt' | 'kst' | 'cat' | 'qct'

export interface HandoffTokenConfig {
  prefix: string             // 'pat_' … literal, never derived
  audience: string           // existing literal, e.g. 'pillar-analysis-narrative'
  secretEnv: string          // may repeat: kst/cat both name KEYWORD_MEMO_TOKEN_SECRET
  devFallbackSecret: string  // each family's CURRENT fallback material, verbatim
  devFallbackWarnPrefix: string // the family's warn [tag]; factory reconstructs the
                                // full warn line (template verified identical ×6)
  scopes: readonly string[]
  ttlSeconds: number         // 3600 for all six today
  makeError(message: string): Error   // constructs the family's legacy error class,
                                      // preserving .name and exact message wording
  transport: 'bearer-strict' | 'bearer-or-query'  // 'bearer-or-query' = cat_ ONLY
  errorPolicy: HandoffAuthErrorPolicy // see §3
}
```

**`lib/handoff/meta.ts` (client-safe):** `{ prefix, idLabel, … }` per family —
no secrets, no node imports, importable by cards. A test pins every registry
value against the current per-module literals.

### 2. `lib/handoff/token.ts` — the factory

`createHandoffTokenFamily(config: HandoffTokenConfig)` returns
`{ mint(id): Promise<MintedToken>, verify(token, expectedId): Promise<JWTPayload> }`
implementing the shared mechanism of the six current modules:

- jose HS256, `iss 'er-seo-tools'`, `aud config.audience`, `sub id`,
  `scope: config.scopes`, expiry `config.ttlSeconds`.
- Secret resolution from `process.env[config.secretEnv]`; production throw
  when unset; the family's own dev fallback secret + warn-once text
  (verbatim from config — NOT a shared string).
- **Errors are thrown through `config.makeError`**, so `instanceof
  PillarTokenError` (etc.) checks in routes/tests keep passing and error
  `.name`/message wording is preserved exactly — a shared base class alone
  cannot satisfy the existing `instanceof` checks. Subject-mismatch and
  expiry message wording per family is characterization-pinned (pat_'s route
  message-sniffs `err.message` — wording is load-bearing wire behavior).

**Facades:** the six existing modules (`lib/pillar-token.ts` etc.) shrink to
config lookup + re-export with their current exported names
(`mintPillarToken`, `verifySeoRoadmapToken`, `KEYWORD_STRATEGY_TOKEN_SCOPES`,
`CONTENT_AUDIT_TOKEN_TTL_MS`, pat_'s `parsePillarPrompt` + regexes, the
legacy error classes, …). No import site anywhere else changes. Existing
per-module tests keep running against the facades.

### 3. `lib/handoff/route-auth.ts` — one auth mechanism, per-family policy

`requireHandoffToken(req, family, expectedId, requiredScope)` →
`{ ok: true, payload } | { ok: false, response }` — fail-closed, never
throws raw. The *mechanism* is shared; every family-visible behavior comes
from its registry policy:

- **Transport is registry-owned, not caller-selectable**: `bearer-strict`
  (five families) vs `bearer-or-query` (cat_ only). cat_'s current
  precedence is pinned exactly: a missing or non-Bearer-shaped
  `Authorization` header falls back to `?token=`; a well-formed `Bearer`
  token that fails verification does NOT fall back to query.
- **Error policy per family** maps each failure stage — missing header,
  malformed header, wrong prefix, verification failure (expired / bad
  signature / wrong sub / other), missing scope, unexpected/verifier error —
  to that family's CURRENT `{ error: code, status }` body: srt/krt's
  `auth_missing`/`auth_malformed`/…/500 `token_service_unavailable`; qct's
  combined `auth_missing_or_malformed`; pat_'s message-sniffed
  `token_expired`/`token_wrong_analysis_id`/`token_invalid_signature`/
  `token_invalid`; kst_'s `tokenErrorCode` taxonomy; cat_'s flat
  `auth_required`/`insufficient_scope`. No response body changes, ever.
- Scope enforcement: same checks as today, centralized (all six already
  enforce; this moves the code, not the behavior).

The two existing helpers (`keyword-strategy-route-auth.ts`,
`content-audit/route-auth.ts`) become facades delegating here (signatures
unchanged). The 8 inline-auth public routes (pat/srt/krt GET+PATCH, qct
GET+POST) adopt the helper. Route URLs, methods, success bodies, and each
family's body-vs-auth ordering: untouched. `middleware.ts`: untouched.

### 4. Prompt composer consolidation

`lib/handoff/prompt.ts` — `composeHandoffPayload(family, parts)` produces
the 3-line contract (`Webapp:` / `<idLabel>:` / `Access token:`) +
per-family instruction lines sourced from the metadata registry. The six
existing composer functions become facades with **byte-identical output**,
including whitespace and trailing-newline behavior. Because today's prompt
tests are mostly `toContain` fragments (and cat_/qct_ have none), **exact
full-string characterization tests for all six composers land BEFORE the
facade switch** (see Testing). cat_'s `buildContentAuditPrompt({appUrl,…})`
and qct_'s numeric-id signature are preserved at the facade.

### 5. Write-back routes: auth adoption only (revision 2)

The four document PATCH routes (pat narrative, srt roadmap, krt memo, kst
memo) differ in body-before-auth ordering, parsing/limits, structured
sidecars, error bodies, update column sets, and timestamp fields
(`narrativeUpdatedAt` / `roadmapUpdatedAt` / `memoUpdatedAt` ×2). Those
stay family-owned in the route files; the only shared piece they adopt is
`requireHandoffToken` (§3), which replaces each route's ~25-line inline auth
block (header parse → verify → error-code mapping → scope check).

**Revision 2 (code-reading finding, supersedes the earlier `memo-emit.ts`
proposal):** the post-update emit is ALREADY a single shared-function call —
`publishInvalidation(memoTopic(<row-derived id>))` — one line per route with
the A5 invariants (post-resolve, outside tx, returned-row key) documented at
each call site. There is nothing left to extract; a wrapper would be
indirection without dedup. The emit lines and the A5 emit-identity tests
(`not.toHaveBeenCalledWith(<wrongId>)`) stay verbatim.

GET export routes are *not* genericized beyond auth. cat_'s
manifest/page/findings and kst_'s volumes route keep their current handlers
(auth facade only). A broader `handleDocumentWriteBack` mega-helper stays
rejected — with parsing, auth ordering, limits, and response bodies all
family-owned, it would be configuration-passing theater.

### 6. Client consolidation: one poller hook + one card (revision 2)

**Revision 2 (code-reading finding):** the four "clone cards" split into two
genuinely different data-flow shapes — SeoRoadmapCard / KeywordMemoCard /
MemoPoller are **server-props driven** (`onChange: router.refresh()`; the
poll tick only extracts a timestamp), while KeywordStrategyCard is
**local-state driven** (onChange fetches at call time; topic re-subscribes
per regenerate because each mint creates a new session row). What is
byte-for-byte quadruplicated — and what A5 PR4 had to patch 4× — is the
~100-line **poller wiring block**: lazily-created `createPollingMachine`,
visibilitychange → `setVisible`, SSE `subscribeTopic(memoTopic(topicId))` →
`machine.invalidate()`, auto-start-anchored-to-mint-time, the health-gated
interval loop (3 s → `SAFETY_POLL_MEMO_MS` 20 s, re-arm fast on drop), and
expired-state handling. So the consolidation unit is a **hook**, plus one
shared card for the two structurally-identical instances:

```ts
// components/handoff/useMemoPoller.ts — the quadruplicated wiring, once.
interface UseMemoPollerOpts {
  topicId: string                    // reactive: kst re-subscribes on change
  onChange: () => void               // router.refresh() OR call-time fetch
  fetchLatestUpdatedAt: () => Promise<string | null | undefined>
                                     // undefined = fetch failed (skip tick)
  initialBaseline: string | null
  syncBaselineWhenIdle?: string | null  // props-driven cards only
  autoStart?: { active: boolean; mintedAt: string | null }
  subscribePollerTrigger?: boolean   // onMemoPollerTrigger wiring (srt, pat)
  lifetimeMs?: number                // default 15 min
}
interface UseMemoPollerResult {
  expired: boolean
  restart: (opts?: { baselineNull?: boolean }) => void  // kst regenerate + expired-retry
}
```

Constants (`POLL_INTERVAL_MS` 3 000, `LIFETIME_MS` 15 min,
`SAFETY_POLL_MEMO_MS` 20 000) move into the hook — one home. Machine
semantics untouched: the hook calls the SAME `createPollingMachine` /
`invalidate()` / `tick()` sequence the four components inline today, and the
A5 behavior suites (invalidate visible/hidden, 20 s cadence suppression,
expired-never-resurrected, machine-never-bypassed) are ported to hook tests
once + per-adoption smokes.

**`components/handoff/MemoHandoffCard.tsx`** — shared card for the two
structurally-identical server-props cards (SeoRoadmapCard, KeywordMemoCard):
props `{ sessionId, pollUrl, extractUpdatedAt, title, headerButton,
renderMemo, emptyState, initialStatus, initialMarkdown, initialUpdatedAt,
initialTokenMintedAt }`, internals = the hook + the shared hydration-safe
UpdatedAt + expired banner. The legacy card files become thin wrappers
supplying their markdown renderer (`RoadmapMarkdown` / `KeywordMemoMarkdown`)
and buttons — public component names/props unchanged for their pages.

**Adoptions that keep their own shells:** pillar `MemoPoller` (renders only
the expired banner — becomes the hook + banner, file/props unchanged) and
`KeywordStrategyCard` (local-state shell, `onMemoArrived`-style state updates
stay in the card; adopts the hook with `restart({baselineNull: true})` on
regenerate and reactive `topicId`; its vestigial SSE-handler pre-fetch —
recorded A5 follow-up — dies here). `PillarAnalysisButtonClient` is NOT a
memo card (analysis status on `pillarAnalysisTopic`) — untouched.

UI-class gates apply: dark-mode variants on every element; no hydration-
mismatch patterns (client components fed serialized initial state, as today).

### 7. Legacy skill deletion (mechanical, last)

- `git rm -r skills/pillar-analysis-narrative/`
- Remove `scripts/build-skill.sh` and the `package.json` `"build:skill"`
  script (both hardcode the legacy skill; er-handoff-memo has no build
  wiring and needs none).
- Update stale references in `docs/pillar-analysis-handoff.md` and
  `docs/pillar-prompt-contract.md` (point at `skills/er-handoff-memo/`).
- The audience string literal `'pillar-analysis-narrative'` is frozen wire
  value and stays everywhere it appears.
- Pre-deletion sweep: `rg "pillar-analysis-narrative|build-skill|build:skill"`
  excluding the frozen audience-literal sites.

## Security notes (security-sensitive class)

- Zero intended auth-behavior change; the risk class is *regression during
  centralization*, countered by the characterization matrix below landing
  before any route switches.
- Scope enforcement, transport rules, and error taxonomies are preserved
  per family; `?token=` stays cat_-only and registry-owned.
- Cross-family isolation for the shared-secret trio (krt/kst/cat — audience
  is the wall) gets explicit rejection tests: a krt_ token must fail kst_
  and cat_ verification and vice versa.
- `middleware.ts` is not modified; existing matcher drift test +
  `middleware.test.ts` stay the gate. audit-ci stays green.

## Testing strategy

1. **Characterization matrix FIRST (own PR-1 tasks, before any behavior
   moves):**
   - Exact full-string tests for all six prompt composers (cat_/qct_ have
     none today; the other four mostly `toContain` — insufficient).
   - Per public route: missing auth, malformed header, wrong prefix, bad
     signature, expired, wrong subject, missing scope, verifier-failure
     (500) where applicable, and the success body — pinning each family's
     exact `{ error: code, status }`.
   - cat_ header/query precedence cases (non-Bearer header → query fallback;
     invalid Bearer → no fallback).
   - Cross-family rejection for the shared-secret trio.
2. Factory/registry unit tests: per-family config-literal pinning, error
   class identity (`instanceof` + `.name` + message wording), dev-fallback
   warn-once.
3. Card: port the A5 SSE behavior suites onto MemoHandoffCard (invalidate
   visible/hidden, 20 s safety cadence, expired-no-resurrect, machine never
   bypassed) + per-adoption smokes.
4. Gates: `tsc --noEmit` + full vitest + build per PR; **`npm run smoke`**
   for any PR touching auth or pillar surfaces (route-auth adoption PR and
   the card PR both qualify — PillarAnalysisButtonClient/MemoPoller render
   on the smoke-walked results page).

## PR structure (blast radius reduced per Codex fix 8)

- **PR 1 — characterization + foundations:** the full characterization
  matrix (against CURRENT code, must pass before and after every later PR);
  registries + token factory + prompt facades + token-module facades. No
  route file, no auth behavior, no UI touched.
- **PR 2 — route-auth adoption:** `lib/handoff/route-auth.ts` + policy
  tables; kst_/cat_ helpers become facades; 8 inline-auth routes adopt
  (emit lines untouched). Characterization matrix green unchanged. Smoke
  run (auth-touching).
- **PR 3 — card consolidation + legacy deletion:** `useMemoPoller` hook +
  `MemoHandoffCard` + 4 adoptions (srt/krt via the card; pillar MemoPoller +
  kst via the hook); legacy skill dir + build wiring removed; docs updated.
  Smoke run (pillar surfaces).

Deploys per rule 1 (autonomous when gate-green, post-deploy verify: health,
one public GET per family 401s with the family's exact error code, prompt
payload unchanged on a real mint, prefix/topic literals intact in minified
chunks).

Note on A5: Kevin's live watches are still pending. PR 3 rewrites the memo
cards' internals while preserving the A5 topology; if the watches haven't
happened by PR 3 merge time, prod behavior stays equivalent, but the session
will call this out so Kevin can sequence his watch before or after at his
choice.

## Success criteria

- All six families mint/verify/compose through `lib/handoff/` with zero wire
  drift (characterization matrix green across all three PRs, untouched).
- The quadruplicated poller wiring lives once in `useMemoPoller` (tested
  with the ported A5 suites); srt/krt render through one shared card.
- `skills/pillar-analysis-narrative/` + `build:skill` wiring gone.
- A dry-run doc section: "adding family #7" enumerating the checklist —
  registry entries (token + meta + error policy), mint/poll routes, GET
  builder, PATCH route with shared emit, card wrapper, middleware matchers
  + tests.

## Things Kevin should verify (from Codex review)

- No consumer besides er-handoff-memo relies on cat_'s query-token fallback
  or its header/query precedence.
- Complete the pending A5 live watches before or immediately after PR 3.
