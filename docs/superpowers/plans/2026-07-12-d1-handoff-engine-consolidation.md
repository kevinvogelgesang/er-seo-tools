# D1 Handoff Engine Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the six hand-cloned skill-handoff token families (pat_/srt_/krt_/kst_/cat_/qct_) behind one `lib/handoff/` engine (registry + token factory + route-auth + prompt composer) and one client poller hook + shared card, with **zero wire-contract change**, then delete the superseded `skills/pillar-analysis-narrative/`.

**Architecture:** Layered facades. New shared modules implement the mechanism; the six existing per-family modules become thin facades re-exporting their current names so no import site, test, route URL, JWT claim, clipboard string, or error body moves. A characterization matrix (exact strings/codes, written FIRST against current code) must stay green across all three PRs. Spec: `docs/superpowers/specs/2026-07-12-d1-handoff-engine-consolidation-design.md`.

**Tech Stack:** Next.js 15 App Router, TypeScript, jose (HS256 JWT), vitest (`// @vitest-environment jsdom` + `afterEach(cleanup)` for components, no jest-dom), Prisma/SQLite.

## Global Constraints

- **Wire contracts are FROZEN**: route URLs, middleware matchers, JWT claims (`iss 'er-seo-tools'`, per-family `aud`, `sub`, `scope`, 3600 s expiry), token prefixes, clipboard payload text, per-family auth error codes/statuses, success bodies. The deployed er-handoff-memo skill v2.3.0 consumes them.
- **No secret unification**: kst_/cat_ share `KEYWORD_MEMO_TOKEN_SECRET` deliberately (audience isolates); pat_/srt_/krt_/qct_ keep `PILLAR_TOKEN_SECRET`/`SEO_ROADMAP_TOKEN_SECRET`/`KEYWORD_MEMO_TOKEN_SECRET`/`QUARTER_PUSH_TOKEN_SECRET`. No new env vars.
- **No changes** to `lib/memo-poller-machine.ts`, `lib/events/*`, `middleware.ts`, `prisma/schema.prisma`.
- Emit lines `publishInvalidation(memoTopic(<row-derived id>))` in the four PATCH routes stay **verbatim** (A5 invariants; post-resolve, outside tx, returned-row key).
- Array-form `$transaction` only (no transactions needed in this work).
- Gates before every merge: `npm run lint` (tsc) + `npm test` + `npm run build`; `npm run smoke` for PR 2 (auth) and PR 3 (pillar surfaces render on the smoke-walked results page). `CHROME_EXECUTABLE` must point at local Chrome for smoke on macOS.
- Component tests: `// @vitest-environment jsdom`, `afterEach(cleanup)`, `vi.mock('@/lib/events/client')` BEFORE importing module-level stores.
- Never `git add -A` at repo root; stage explicit paths. No backticks in `-m` messages.
- UI: dark-mode variants on every element; hydration-safe patterns only (mounted-guard for locale strings).

## Reference: per-family literals (copied from code 2026-07-12)

| | pat_ | srt_ | krt_ | kst_ | cat_ | qct_ |
|---|---|---|---|---|---|---|
| Module | `lib/pillar-token.ts` | `lib/seo-roadmap-token.ts` | `lib/keyword-memo-token.ts` | `lib/keyword-strategy-token.ts` | `lib/content-audit-token.ts` | `lib/quarter-push-token.ts` |
| Audience | `pillar-analysis-narrative` | `seo-audit-roadmap` | `keyword-strategy-memo` | `keyword-strategy-client` | `content-audit-client` | `quarter-cycle-push` |
| Secret env | `PILLAR_TOKEN_SECRET` | `SEO_ROADMAP_TOKEN_SECRET` | `KEYWORD_MEMO_TOKEN_SECRET` | `KEYWORD_MEMO_TOKEN_SECRET` | `KEYWORD_MEMO_TOKEN_SECRET` | `QUARTER_PUSH_TOKEN_SECRET` |
| Scopes | `['read','narrative-write']` | `['read','roadmap-write']` | `['read','memo-write']` | `['read','memo-write','volume-lookup']` | `['read','findings-write']` | `['read','receipt-write']` |
| Error class | `PillarTokenError` | `SeoRoadmapTokenError` | `KeywordMemoTokenError` | `KeywordStrategyTokenError` | `ContentAuditTokenError` | `QuarterPushTokenError` |
| Wrong-sub route code | `token_wrong_analysis_id` | `token_wrong_roadmap_id` | `token_wrong_memo_id` | `token_wrong_session_id` | (collapsed: `auth_required`) | `token_wrong_plan_id` |
| Missing/malformed header | (per-route, see routes) | `auth_missing` / `auth_malformed` | `auth_missing` / `auth_malformed` | `auth_missing` / `auth_malformed` | `auth_required` | `auth_missing_or_malformed` (combined) |
| Transport | bearer-strict | bearer-strict | bearer-strict | bearer-strict | bearer-or-query | bearer-strict |
| Verifier-throw (non-family error) | 500 `token_service_unavailable` | 500 `token_service_unavailable` | 500 `token_service_unavailable` | 500 `token_service_unavailable` | 401 `auth_required` (collapsed) | 500 `token_service_unavailable` |

Every value above must be re-verified against the module/route source when the registry entry is written — the SOURCE FILES are authoritative, not this table.

---

# PR 1 — Characterization + foundations (branch `feat/d1-pr1-foundations`)

### Task 1: Prompt-composer characterization tests (exact full strings, ×6)

**Files:**
- Create: `lib/handoff/prompt-characterization.test.ts`

**Interfaces:**
- Consumes: the six existing composers — `composePayload` (`lib/pillar-prompt.ts`), `composeRoadmapPayload` (`lib/seo-roadmap-prompt.ts`), `composeKeywordMemoPayload` (`lib/keyword-memo-prompt.ts`), `composeKeywordStrategyPayload` (`lib/keyword-strategy-prompt.ts`), `buildContentAuditPrompt` (`lib/content-audit-prompt.ts`), `composeQuarterPushPayload` (`lib/quarter-push-prompt.ts`).
- Produces: the frozen-string regression net every later task runs against.

- [ ] **Step 1: Capture current outputs mechanically**

Run this and keep the output — it is the expected value for the tests (do NOT hand-transcribe):

```bash
npx tsx -e "
import { composePayload } from './lib/pillar-prompt';
import { composeRoadmapPayload } from './lib/seo-roadmap-prompt';
import { composeKeywordMemoPayload } from './lib/keyword-memo-prompt';
import { composeKeywordStrategyPayload } from './lib/keyword-strategy-prompt';
import { buildContentAuditPrompt } from './lib/content-audit-prompt';
import { composeQuarterPushPayload } from './lib/quarter-push-prompt';
const W = 'https://seo.example.com', T = 'PREFIX_tokentoken', I = 'id-123';
for (const [name, s] of [
  ['pat', composePayload({ webappUrl: W, analysisId: I, token: 'pat_tok' })],
  ['srt', composeRoadmapPayload({ webappUrl: W, roadmapId: I, token: 'srt_tok' })],
  ['krt', composeKeywordMemoPayload({ webappUrl: W, memoId: I, token: 'krt_tok' })],
  ['kst', composeKeywordStrategyPayload({ webappUrl: W, strategyId: I, token: 'kst_tok' })],
  ['cat', buildContentAuditPrompt({ appUrl: W, siteAuditId: I, token: 'cat_tok' })],
  ['qct', composeQuarterPushPayload({ webappUrl: W, planId: 42, token: 'qct_tok' })],
] as const) console.log('=== ' + name + ' ===\n' + JSON.stringify(s));
"
```

(If any composer's actual param names differ, read its file and fix the call — the printed JSON string is the ground truth either way.)

- [ ] **Step 2: Write the characterization test file**

One test per family asserting `toBe(<the exact JSON-parsed string from Step 1>)` (use template literals with the exact captured text, including trailing-newline behavior):

```ts
// lib/handoff/prompt-characterization.test.ts
// D1 frozen-wire net: EXACT clipboard payload strings for all six handoff
// families. If one of these fails, a wire contract consumed by the deployed
// er-handoff-memo skill has drifted — fix the code, never the test.
import { describe, it, expect } from 'vitest';
import { composeRoadmapPayload } from '../seo-roadmap-prompt';
// … import all six

describe('handoff prompt characterization (frozen wire)', () => {
  it('srt_ composeRoadmapPayload exact output', () => {
    expect(
      composeRoadmapPayload({ webappUrl: 'https://seo.example.com', roadmapId: 'id-123', token: 'srt_tok' }),
    ).toBe(
      'Generate a technical SEO roadmap for this site.\n\nWebapp: https://seo.example.com\nRoadmap ID: id-123\nAccess token: srt_tok\n(Expires in 1h)\n\nFetch the audit payload, write the prioritized technical-SEO roadmap, and post it back to the dashboard.',
    );
  });
  // … one exact-string test per remaining family, from the Step 1 capture
});
```

- [ ] **Step 3: Run tests — all green against CURRENT code**

Run: `npx vitest run lib/handoff/prompt-characterization.test.ts`
Expected: 6 passing (characterization: green from birth; a failure means the capture was transcribed wrong — recapture).

- [ ] **Step 4: Commit**

```bash
git add lib/handoff/prompt-characterization.test.ts
git commit -m "test(d1): exact-string characterization for all six handoff prompt composers"
```

### Task 2: Public-route auth characterization matrix

**Files:**
- Create: `lib/handoff/route-auth-characterization.test.ts`
- Read (fixtures/expected values): `app/api/pillar-analysis/[id]/route.ts` + `[id]/narrative/route.ts`, `app/api/seo-roadmap/[id]/route.ts` + `[id]/roadmap/route.ts`, `app/api/keyword-memo/[id]/route.ts` + `[id]/memo/route.ts`, `app/api/keyword-strategy/[id]/route.ts` (+ `memo`, `volumes`), `app/api/content-audit/[id]/manifest/route.ts` (+ `page`, `findings`), `app/api/quarter-plan/push/[planId]/route.ts` + `receipt/route.ts`, and their existing `route.test.ts` siblings.

**Interfaces:**
- Consumes: the route handlers' exported `GET`/`PATCH`/`POST` functions (call them directly with a constructed `NextRequest`, the pattern the existing route tests use — copy the harness style from `app/api/seo-roadmap/[id]/route.test.ts`).
- Produces: per-route × per-failure-stage pinned `{ error, status }` — the gate PR 2 must keep green.

- [ ] **Step 1: Audit existing route tests for already-pinned cases**

Run: `grep -rn "auth_missing\|auth_malformed\|token_missing_scope\|token_expired\|token_wrong\|auth_required\|insufficient_scope\|token_service_unavailable\|auth_missing_or_malformed" app/api/pillar-analysis app/api/seo-roadmap app/api/keyword-memo app/api/keyword-strategy app/api/content-audit app/api/quarter-plan --include="*.test.ts" -l`

List which of the matrix cells below are already covered; the new file adds ONLY the missing cells (do not duplicate — reference which existing test file covers each skipped cell in a comment).

- [ ] **Step 2: Write the missing matrix cells**

Matrix per public route (14 routes): `no Authorization header`, `non-Bearer header`, `wrong prefix (Bearer krt_… on an srt_ route etc.)`, `expired token`, `bad signature (token signed with a different secret)`, `wrong sub (valid token for another id)`, `missing scope (hand-signed token with scope: ['read'] on a write route / [] on a read route)`, `success`. Expected codes/statuses per family are in the Reference table; **read each route file and copy its literal codes** (e.g. pillar collapses missing/malformed handling differently from srt — pin what the code does, not what the table approximates). Token forging helper (copy the pattern already used in `app/api/pillar-analysis/[id]/route.test.ts:69` — hand-built `SignJWT` with `.setAudience(...)`):

```ts
import { SignJWT } from 'jose';
async function forge(opts: {
  aud: string; sub: string; scope: string[]; secret: string; prefix: string;
  expSecondsFromNow?: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: opts.scope })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('er-seo-tools')
    .setAudience(opts.aud)
    .setSubject(opts.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expSecondsFromNow ?? 3600))
    .sign(new TextEncoder().encode(opts.secret));
  return opts.prefix + jwt;
}
```

Each test asserts `res.status` AND `await res.json()` `error` code exactly. DB-backed cases (success, wrong-sub-with-existing-row) self-provision rows per the house per-worker-DB pattern (copy setup from the sibling route test file).

- [ ] **Step 3: Run — green against CURRENT code**

Run: `npx vitest run lib/handoff/route-auth-characterization.test.ts`
Expected: PASS (characterization). Any failure = you mis-read a route; fix the test.

- [ ] **Step 4: Commit**

```bash
git add lib/handoff/route-auth-characterization.test.ts
git commit -m "test(d1): auth characterization matrix for all public handoff routes"
```

### Task 3: cat_ transport precedence + cross-family rejection tests

**Files:**
- Create: `lib/handoff/cross-family-characterization.test.ts`

**Interfaces:**
- Consumes: `requireContentAuditToken` (`lib/content-audit/route-auth.ts`), `verifyKeywordMemoToken`, `verifyKeywordStrategyToken`, `verifyContentAuditToken`, the `forge` helper from Task 2 (duplicate it here — test files don't share helpers in this repo).
- Produces: pinned cat_ header/query precedence + audience-isolation guarantees for the shared-secret trio.

- [ ] **Step 1: Write the tests**

```ts
// Pinned cat_ transport precedence (lib/content-audit/route-auth.ts bearer()):
// 1. missing Authorization header + ?token=<valid> → accepted (query fallback)
// 2. non-Bearer Authorization header + ?token=<valid> → accepted (falls back)
// 3. 'Bearer <invalid>' + ?token=<valid> → 401 auth_required (header token
//    was extracted; an invalid Bearer NEVER falls back to query)
// 4. missing header + no query → 401 auth_required
//
// Cross-family isolation (krt/kst/cat share KEYWORD_MEMO_TOKEN_SECRET):
// a krt_-audience JWT presented to verifyKeywordStrategyToken and
// verifyContentAuditToken must THROW (audience mismatch), and each
// permutation of the trio likewise (6 rejection cases), same sub, same secret.
```

Write each listed case as a real test (construct `NextRequest` with `new NextRequest('http://x/api/content-audit/ID/manifest?token=…', { headers: … })`).

- [ ] **Step 2: Run — green against CURRENT code**

Run: `npx vitest run lib/handoff/cross-family-characterization.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/handoff/cross-family-characterization.test.ts
git commit -m "test(d1): cat_ transport precedence + shared-secret trio audience-isolation characterization"
```

### Task 4: `lib/handoff/registry.ts` + `lib/handoff/meta.ts`

**Files:**
- Create: `lib/handoff/registry.ts` (server-only), `lib/handoff/meta.ts` (client-safe), `lib/handoff/registry.test.ts`

**Interfaces:**
- Produces (Task 5/6/7 depend on these exact names):
  - `type HandoffFamilyKey = 'pat' | 'srt' | 'krt' | 'kst' | 'cat' | 'qct'`
  - `interface HandoffTokenConfig { prefix: string; audience: string; secretEnv: string; devFallbackSecret: string; devFallbackWarnPrefix: string; scopes: readonly string[]; ttlSeconds: number; makeError(message: string): Error }`
  - `const HANDOFF_TOKEN_CONFIGS: Record<HandoffFamilyKey, HandoffTokenConfig>`
  - `meta.ts`: `interface HandoffMeta { prefix: string; idLabel: string }`, `const HANDOFF_META: Record<HandoffFamilyKey, HandoffMeta>` — NO server imports.

- [ ] **Step 1: Write the failing literal-pinning test**

```ts
// lib/handoff/registry.test.ts
import { describe, it, expect } from 'vitest';
import { HANDOFF_TOKEN_CONFIGS } from './registry';
import { HANDOFF_META } from './meta';

describe('HANDOFF_TOKEN_CONFIGS literals', () => {
  it('pins every family to its legacy module literals', () => {
    expect(HANDOFF_TOKEN_CONFIGS.pat).toMatchObject({
      prefix: 'pat_', audience: 'pillar-analysis-narrative',
      secretEnv: 'PILLAR_TOKEN_SECRET', ttlSeconds: 3600,
      scopes: ['read', 'narrative-write'],
    });
    // … one block per family, values copied from each lib/<x>-token.ts SOURCE
    // (devFallbackSecret too, e.g. pat: 'dev-pillar-token-secret-do-not-use-in-prod')
  });
  it('makeError constructs the legacy class with preserved name', () => {
    const e = HANDOFF_TOKEN_CONFIGS.pat.makeError('boom');
    expect(e.name).toBe('PillarTokenError');
    expect(e.message).toBe('boom');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run lib/handoff/registry.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

`registry.ts`: copy every literal verbatim from the six token modules (prefix/audience/secretEnv/devFallbackSecret/warn text/scopes/ttl). `makeError` imports the legacy error classes — **to avoid a cycle** (facades will import the registry), move each error class INTO the registry file? No — keep classes where they are exported from today by defining them in a new `lib/handoff/errors.ts` and having each legacy module re-export its class from there:

```ts
// lib/handoff/errors.ts — single home for the six legacy error classes.
// Names and behavior are frozen (routes message-sniff and instanceof these).
export class PillarTokenError extends Error {
  constructor(message: string) { super(message); this.name = 'PillarTokenError'; }
}
export class SeoRoadmapTokenError extends Error { /* same shape, name 'SeoRoadmapTokenError' */ }
// … KeywordMemoTokenError, KeywordStrategyTokenError, ContentAuditTokenError, QuarterPushTokenError
```

`registry.ts` then: `makeError: (m) => new PillarTokenError(m)` per family. `meta.ts` holds `{prefix, idLabel}` only (`Analysis ID`/`Roadmap ID`/`Memo ID`/`Strategy ID`/`Content Audit ID`/`Plan ID` — verify each against its prompt module before writing).

- [ ] **Step 4: Run tests to verify pass** — `npx vitest run lib/handoff/registry.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/handoff/registry.ts lib/handoff/meta.ts lib/handoff/errors.ts lib/handoff/registry.test.ts
git commit -m "feat(d1): HANDOFF_TOKEN_CONFIGS registry + client-safe meta + single-home error classes"
```

### Task 5: `lib/handoff/token.ts` factory

**Files:**
- Create: `lib/handoff/token.ts`, `lib/handoff/token.test.ts`

**Interfaces:**
- Consumes: `HANDOFF_TOKEN_CONFIGS` (Task 4).
- Produces: `createHandoffTokenFamily(config: HandoffTokenConfig): { mint(id: string): Promise<{ token: string; expiresAt: string }>; verify(token: string, expectedId: string): Promise<JWTPayload> }` — exact behavioral clone of the per-module implementations (see `lib/pillar-token.ts` as the canonical shape).

- [ ] **Step 1: Write failing tests** — port the assertions from `lib/pillar-token.test.ts` but against the factory, plus the factory-specific cases:

```ts
// lib/handoff/token.test.ts (sketch of the required cases; write all)
// - mint: token starts with config.prefix; payload has iss/aud/sub/scope/exp
// - verify: valid round-trip returns payload
// - verify: wrong prefix → throws config error class, message 'token missing <prefix> prefix'
// - verify: expired → error class, message contains 'expired' (route sniffing depends on it)
// - verify: wrong sub → error class, message contains 'does not match' (route sniffing)
// - verify: bad signature → error class, message contains 'signature'? NO —
//   verify wraps jose errors as 'token verification failed: <jose msg>'; the
//   'signature' substring comes from jose. Assert the wrapped-prefix form
//   exactly as lib/pillar-token.ts:89-91 produces it.
// - prod + unset secret → throws config error class (message per module)
// - dev + unset secret → warns ONCE per family (spy console.warn), uses fallback
// - two families with the same secretEnv (kst/cat) verify-reject each other's
//   tokens (audience mismatch)
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run lib/handoff/token.test.ts` → FAIL.

- [ ] **Step 3: Implement `lib/handoff/token.ts`** — transcribe `lib/pillar-token.ts`'s logic parameterized by config; per-family `didWarn` flag lives in a `Map<string, boolean>` keyed by config.prefix; every `throw new PillarTokenError(...)` becomes `throw config.makeError(...)` with the SAME message templates (messages are sniffed by routes: keep `token missing ${prefix} prefix`, `token verification failed: ${…}`, `token sub (${sub}) does not match expected … (${expected})` — check each legacy module for its exact sub-mismatch noun phrase and preserve per family via a config `subNoun`? READ all six first: if wording differs per family (pillar says 'expected analysis id'), add `wrongSubMessage(sub, expected): string` to the config instead of a shared template).

- [ ] **Step 4: Run tests** — PASS. Also `npx vitest run lib` (registry+token green).

- [ ] **Step 5: Commit**

```bash
git add lib/handoff/token.ts lib/handoff/token.test.ts lib/handoff/registry.ts
git commit -m "feat(d1): handoff token factory (mint/verify parity with per-family error identity)"
```

### Task 6: Token-module facades ×6

**Files:**
- Modify: `lib/pillar-token.ts`, `lib/seo-roadmap-token.ts`, `lib/keyword-memo-token.ts`, `lib/keyword-strategy-token.ts`, `lib/content-audit-token.ts`, `lib/quarter-push-token.ts`

**Interfaces:**
- Every currently-exported name survives verbatim: `mintPillarToken`, `verifyPillarToken`, `PillarTokenError`, `MintedToken`, `KEYWORD_STRATEGY_TOKEN_SCOPES`, `CONTENT_AUDIT_TOKEN_SCOPES`, `CONTENT_AUDIT_TOKEN_TTL_MS`, etc. Run `grep -n "^export" lib/<x>-token.ts` per module FIRST and preserve the full list.

- [ ] **Step 1: Rewrite each module as a facade** (pillar shown; repeat per family with its own names):

```ts
// lib/pillar-token.ts — facade over lib/handoff (D1). Wire contract unchanged.
import { createHandoffTokenFamily } from './handoff/token';
import { HANDOFF_TOKEN_CONFIGS } from './handoff/registry';
export { PillarTokenError } from './handoff/errors';
export interface MintedToken { token: string; expiresAt: string }
const family = createHandoffTokenFamily(HANDOFF_TOKEN_CONFIGS.pat);
export const mintPillarToken = (analysisId: string): Promise<MintedToken> => family.mint(analysisId);
export const verifyPillarToken = (token: string, expectedAnalysisId: string) => family.verify(token, expectedAnalysisId);
```

(kst_/cat_ additionally re-export their scope consts / TTL const from the registry values — keep the exported VALUES identical.)

- [ ] **Step 2: Run the full existing per-module test files + characterization**

Run: `npx vitest run lib/pillar-token.test.ts lib/seo-roadmap-token.test.ts lib/keyword-memo-token.test.ts lib/keyword-strategy-token.test.ts lib/content-audit-token.test.ts lib/quarter-push-token.test.ts lib/handoff`
Expected: ALL PASS untouched — this is the point of the facade. If a test fails, the factory diverges: fix the FACTORY, never the legacy test.

- [ ] **Step 3: Full gate sweep** — `npm run lint && npm test` → green.

- [ ] **Step 4: Commit**

```bash
git add lib/pillar-token.ts lib/seo-roadmap-token.ts lib/keyword-memo-token.ts lib/keyword-strategy-token.ts lib/content-audit-token.ts lib/quarter-push-token.ts
git commit -m "refactor(d1): six token modules become facades over the handoff factory (exports unchanged)"
```

### Task 7: `lib/handoff/prompt.ts` + composer facades ×6

**Files:**
- Create: `lib/handoff/prompt.ts`
- Modify: the six `lib/*-prompt.ts` modules (facades; `parsePillarPrompt` + its regexes stay in `lib/pillar-prompt.ts` untouched)

**Interfaces:**
- Produces: `composeHandoffPayload(family: HandoffFamilyKey, args: { webappUrl: string; id: string; token: string }): string`, driven by per-family `{ introLine, idLabel, outroLine }` in `HANDOFF_META` (extend the Task 4 interface with those fields — copy each family's exact lines from its composer source).
- Facades keep their exact current signatures (`composeRoadmapPayload({webappUrl,roadmapId,token})`, `buildContentAuditPrompt({appUrl,siteAuditId,token})`, qct's `planId: number`, …).

- [ ] **Step 1: Extend `meta.ts`** with `introLine`/`outroLine` per family (verbatim from each composer) and implement `composeHandoffPayload` reproducing the exact `[join('\n')]` structure of `lib/seo-roadmap-prompt.ts:8-17`. If any family's structure deviates beyond intro/label/outro (READ all six first — cat_/qct_ likely differ), keep THAT family's composer body inline in its facade and do NOT force it through the shared composer; the characterization test decides.

- [ ] **Step 2: Convert facades** — each `lib/*-prompt.ts` delegates to `composeHandoffPayload` (or keeps its body, per Step 1 finding), preserving exported names/param shapes.

- [ ] **Step 3: Run characterization** — `npx vitest run lib/handoff/prompt-characterization.test.ts` plus the existing per-module prompt tests → ALL PASS byte-identical.

- [ ] **Step 4: Full gates** — `npm run lint && npm test && npm run build` → green.

- [ ] **Step 5: Commit + push + PR**

```bash
git add lib/handoff/prompt.ts lib/handoff/meta.ts lib/pillar-prompt.ts lib/seo-roadmap-prompt.ts lib/keyword-memo-prompt.ts lib/keyword-strategy-prompt.ts lib/content-audit-prompt.ts lib/quarter-push-prompt.ts
git commit -m "refactor(d1): prompt composers become facades over composeHandoffPayload (byte-identical output)"
git push -u origin feat/d1-pr1-foundations
gh pr create --title "D1 PR1: handoff characterization net + token/prompt engine + facades" --body "..."
```

Merge when gate-green (rule 1); deploy optional for PR 1 (no behavior change) — deploy with PR 2 at the latest.

---

# PR 2 — Route-auth adoption (branch `feat/d1-pr2-route-auth`)

### Task 8: `lib/handoff/route-auth.ts` with per-family error policy

**Files:**
- Create: `lib/handoff/route-auth.ts`, `lib/handoff/route-auth.test.ts`

**Interfaces:**
- Consumes: `createHandoffTokenFamily`/configs (PR 1), legacy error classes.
- Produces:

```ts
export type HandoffAuthResult =
  | { ok: true; payload: JWTPayload }
  | { ok: false; response: NextResponse }
export async function requireHandoffToken(
  req: NextRequest,
  family: HandoffFamilyKey,
  expectedId: string,
  requiredScope: string,
): Promise<HandoffAuthResult>
```

- Policy lives in the registry: extend `HandoffTokenConfig` with

```ts
transport: 'bearer-strict' | 'bearer-or-query'   // 'bearer-or-query' = cat only
authErrors: {
  missingHeader: { error: string; status: number }      // srt/krt/kst: auth_missing · qct: auth_missing_or_malformed · cat: auth_required · pat: per current route code (READ IT)
  malformedHeader: { error: string; status: number }    // srt/krt/kst: auth_malformed · qct: auth_missing_or_malformed · cat: auth_required · pat: per current route code
  tokenError(message: string): { error: string; status: number }
    // pat/srt/krt/kst/qct: the tokenErrorCode() message-sniff with the family's
    // wrong-sub code (see Reference table), status 401
    // cat: always { error: 'auth_required', status: 401 }
  verifierUnavailable: { error: string; status: number } // 500 token_service_unavailable; cat: 401 auth_required
  missingScope: { error: string; status: number }        // token_missing_scope; cat: insufficient_scope
}
```

- [ ] **Step 1: Write failing tests** — for each family × each stage, assert `requireHandoffToken` returns the exact `{error,status}` the characterization matrix pinned at the route level (reuse the `forge` helper). Include cat_ query-fallback precedence cases (mirror Task 3's four cases through the helper).

- [ ] **Step 2: Run to verify fail.** `npx vitest run lib/handoff/route-auth.test.ts` → FAIL.

- [ ] **Step 3: Implement** — extraction per transport policy (Bearer regex `^Bearer\s+(<prefix>\S+)$` for bearer-strict, replicating each route's CURRENT regex; cat_'s `bearer()` header-startsWith + query fallback verbatim from `lib/content-audit/route-auth.ts:12-16`), verify via factory, map errors through `config.authErrors`, scope check last. Never throws: outermost try/catch → `verifierUnavailable` policy.

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/handoff/route-auth.ts lib/handoff/route-auth.test.ts lib/handoff/registry.ts lib/handoff/registry.test.ts
git commit -m "feat(d1): shared requireHandoffToken with per-family transport + error policy"
```

### Task 9: kst_/cat_ helper facades

**Files:**
- Modify: `lib/keyword-strategy-route-auth.ts`, `lib/content-audit/route-auth.ts`

- [ ] **Step 1: Rewrite both as facades** — `authenticateStrategyRequest(req, sessionId, requiredScope)` → `requireHandoffToken(req, 'kst', sessionId, requiredScope)` (map result shape: kst_ helper returns `{ok:false,response}`, cat_ returns `{ok:false,res}` — PRESERVE each helper's current return property names); `requireContentAuditToken(req, siteAuditId, scope)` → `requireHandoffToken(req, 'cat', siteAuditId, scope)` with the `res` key and the `payload` type cast kept.

- [ ] **Step 2: Run their route tests + characterization** — `npx vitest run app/api/keyword-strategy app/api/content-audit lib/handoff` → ALL PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/keyword-strategy-route-auth.ts lib/content-audit/route-auth.ts
git commit -m "refactor(d1): kst/cat route-auth helpers delegate to requireHandoffToken (signatures unchanged)"
```

### Task 10: Adopt in srt_/krt_ routes (4 files, identical policy)

**Files:**
- Modify: `app/api/seo-roadmap/[id]/route.ts`, `app/api/seo-roadmap/[id]/roadmap/route.ts`, `app/api/keyword-memo/[id]/route.ts`, `app/api/keyword-memo/[id]/memo/route.ts`

- [ ] **Step 1: Replace each route's inline auth block** (header parse → verify → tokenErrorCode → scope, e.g. `app/api/seo-roadmap/[id]/roadmap/route.ts:49-74`) with:

```ts
const auth = await requireHandoffToken(req, 'srt', id, REQUIRED_SCOPE);
if (!auth.ok) return auth.response;
```

**Ordering is frozen**: the PATCH routes parse+validate the body BEFORE auth (route comment says so) — keep the call exactly where step 2 began. Delete each route's now-unused local `tokenErrorCode` and verify imports. Emit lines untouched.

- [ ] **Step 2: Run route tests + characterization matrix** — `npx vitest run app/api/seo-roadmap app/api/keyword-memo lib/handoff` → ALL PASS unchanged.

- [ ] **Step 3: Commit**

```bash
git add app/api/seo-roadmap app/api/keyword-memo
git commit -m "refactor(d1): srt/krt routes adopt requireHandoffToken (bodies/order/emits unchanged)"
```

### Task 11: Adopt in pat_ + qct_ routes (4 files, per-family policies)

**Files:**
- Modify: `app/api/pillar-analysis/[id]/route.ts`, `app/api/pillar-analysis/[id]/narrative/route.ts`, `app/api/quarter-plan/push/[planId]/route.ts`, `app/api/quarter-plan/push/[planId]/receipt/route.ts`

- [ ] **Step 1: READ each route's auth section first** and confirm its literal missing/malformed codes match the registry policy written in Task 8 (pat_'s differ from srt_'s — the policy must reproduce what pillar's routes actually return today, including any combined-code behavior; qct uses `auth_missing_or_malformed` for both). If a mismatch exists between policy and route, fix the POLICY (Task 8 tests) first, then adopt.

- [ ] **Step 2: Replace the inline blocks** with `requireHandoffToken(req, 'pat'|'qct', id, REQUIRED_SCOPE)` as in Task 10 (qct receipt keeps its own JSON-body/404/500 handling after auth).

- [ ] **Step 3: Run route tests + full characterization** — `npx vitest run app/api/pillar-analysis app/api/quarter-plan lib/handoff` → ALL PASS.

- [ ] **Step 4: Full gates + smoke**

Run: `npm run lint && npm test && npm run build && npm run smoke`
Expected: all green (smoke walks the ADA/results path where pillar surfaces render, and this PR touches auth).

- [ ] **Step 5: Commit + push + PR + merge + deploy**

```bash
git add app/api/pillar-analysis app/api/quarter-plan
git commit -m "refactor(d1): pat/qct routes adopt requireHandoffToken; PR2 complete"
git push -u origin feat/d1-pr2-route-auth
gh pr create --title "D1 PR2: routes adopt shared handoff route-auth (wire-frozen)" --body "..."
```

Merge when gate-green; deploy (`ssh seo@144.126.213.242 "~/deploy.sh"`); post-deploy verify: `/api/health` ok; one public GET per family without a token returns that family's exact error code (curl matrix: `pillar-analysis/x`, `seo-roadmap/x`, `keyword-memo/x`, `keyword-strategy/x`, `content-audit/x/manifest`, `quarter-plan/push/1`); error log quiet; prefix literals (`pat_`, `srt_`, …) intact in minified chunks.

---

# PR 3 — Client consolidation + legacy deletion (branch `feat/d1-pr3-cards`)

### Task 12: `components/handoff/useMemoPoller.ts` hook

**Files:**
- Create: `components/handoff/useMemoPoller.ts`, `components/handoff/useMemoPoller.test.tsx`

**Interfaces:**
- Consumes: `createPollingMachine` (`@/lib/memo-poller-machine`), `onMemoPollerTrigger` (`@/lib/memo-poller-events`), `subscribeTopic`/`subscribeHealth` (`@/lib/events/client`), `memoTopic` (`@/lib/events/topics`).
- Produces (Tasks 13–15 depend on these exact names):

```ts
export const POLL_INTERVAL_MS = 3000;
export const LIFETIME_MS = 15 * 60 * 1000;
export const SAFETY_POLL_MEMO_MS = 20_000;
export interface UseMemoPollerOpts {
  topicId: string;
  onChange: () => void;
  fetchLatestUpdatedAt: () => Promise<string | null | undefined>;
  initialBaseline: string | null;
  syncBaselineWhenIdle?: string | null;
  autoStart?: { active: boolean; mintedAt: string | null };
  subscribePollerTrigger?: boolean;
  lifetimeMs?: number;
}
export interface UseMemoPollerResult {
  expired: boolean;
  restart: (opts?: { baselineNull?: boolean }) => void;
}
export function useMemoPoller(opts: UseMemoPollerOpts): UseMemoPollerResult
```

- [ ] **Step 1: Write failing behavior tests** (`// @vitest-environment jsdom`, `afterEach(cleanup)`, `vi.mock('@/lib/events/client')` BEFORE imports; render the hook via a probe component; fake timers). Port the A5 suites — copy the concrete test bodies from `components/seo-parser/SeoRoadmapCard.test.tsx` and `components/clients/KeywordStrategyCard.test.tsx` (the invalidate-visible/hidden, 20 s-cadence-suppression, expired-no-resurrect, stale-processing-no-restart cases), re-targeted at the hook probe. Additional hook-specific cases: `restart({baselineNull:true})` starts with null baseline; reactive `topicId` re-subscribes (assert `subscribeTopic` called with the new topic and unsubscribed from the old — the A5 `not.toHaveBeenCalledWith(<wrongId>)` pattern).

- [ ] **Step 2: Run to verify fail.** `npx vitest run components/handoff/useMemoPoller.test.tsx` → FAIL.

- [ ] **Step 3: Implement the hook** — transcribe the wiring from `components/seo-parser/SeoRoadmapCard.tsx:85-187` + KeywordStrategyCard's reactive-topic effect, parameterized per the opts. The SSE effect body is exactly `subscribeTopic(memoTopic(topicId), () => machine.invalidate())` — the kst_ pre-invalidate fetch is intentionally DROPPED (vestigial per A5 review: its onChange fetches at call time).

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add components/handoff/useMemoPoller.ts components/handoff/useMemoPoller.test.tsx
git commit -m "feat(d1): useMemoPoller hook — the quadruplicated A5 poller wiring, once"
```

### Task 13: `MemoHandoffCard` + SeoRoadmapCard/KeywordMemoCard adoption

**Files:**
- Create: `components/handoff/MemoHandoffCard.tsx`, `components/handoff/MemoHandoffCard.test.tsx`
- Modify: `components/seo-parser/SeoRoadmapCard.tsx`, `components/keyword-research/KeywordMemoCard.tsx`

**Interfaces:**
- Produces:

```ts
interface MemoHandoffCardProps {
  sessionId: string;
  pollUrl: string;                              // e.g. `/api/seo-roadmap/by-session/${sessionId}`
  extractUpdatedAt: (body: unknown) => string | null;  // body?.seoRoadmap?.roadmapUpdatedAt ?? null
  title: string;
  headerButton: ReactNode;                      // GenerateRoadmapButton / keyword equivalent
  renderMemo: (markdown: string) => ReactNode;  // RoadmapMarkdown / KeywordMemoMarkdown
  emptyState: ReactNode;
  sectionId?: string;                           // 'seo-roadmap' anchor
  expiredCta: string;                           // 'Check for roadmap' / current krt text
  initialStatus: string;
  initialMarkdown: string | null;
  initialUpdatedAt: string | null;
  initialTokenMintedAt: string | null;
}
```

- Card internals: `useRouter` + `useMemoPoller({ topicId: sessionId, onChange: () => routerRef.current.refresh(), fetchLatestUpdatedAt: fetch(pollUrl)→extractUpdatedAt (undefined on !ok/catch), initialBaseline: initialUpdatedAt, syncBaselineWhenIdle: initialUpdatedAt, autoStart: { active: initialStatus === 'processing', mintedAt: initialTokenMintedAt }, subscribePollerTrigger: true })`, plus the hydration-safe UpdatedAt (move `RoadmapUpdatedAt` here as `MemoUpdatedAt`) and the expired banner with `restart()`. Markup/classes copied from SeoRoadmapCard (dark variants preserved).

- [ ] **Step 1: Write failing card tests** — render with fake props: shows emptyState when no markdown; renders memo via renderMemo; expired banner appears when the machine expires and its button restarts; correct pollUrl fetched on tick.

- [ ] **Step 2: Run to verify fail**, then implement the card. → PASS.

- [ ] **Step 3: Convert SeoRoadmapCard + KeywordMemoCard to wrappers** — keep file paths, exported names, and Props interfaces IDENTICAL (their pages' imports don't change); each becomes ~30 lines instantiating MemoHandoffCard with its title/renderer/button/pollUrl/extractor. First `grep -n "SeoRoadmapCard\|KeywordMemoCard" app components --include="*.tsx" -r` to confirm all call sites and prop shapes.

- [ ] **Step 4: Run the existing card test files** — `npx vitest run components/seo-parser/SeoRoadmapCard.test.tsx components/keyword-research/KeywordMemoCard.test.tsx components/handoff` → ALL PASS (the A5 suites gate the wrappers).

- [ ] **Step 5: Commit**

```bash
git add components/handoff components/seo-parser/SeoRoadmapCard.tsx components/keyword-research/KeywordMemoCard.tsx
git commit -m "feat(d1): MemoHandoffCard; SeoRoadmapCard + KeywordMemoCard become thin wrappers"
```

### Task 14: MemoPoller adoption (pillar)

**Files:**
- Modify: `app/(app)/pillar-analysis/[id]/components/MemoPoller.tsx`

- [ ] **Step 1: Rewrite MemoPoller onto the hook** — props unchanged; body becomes `useMemoPoller({ topicId: sessionId ?? analysisId, onChange: router.refresh via ref, fetchLatestUpdatedAt: fetch(by-session or by-analysis URL)→body?.pillarAnalysis?.narrativeUpdatedAt, initialBaseline: initialNarrativeUpdatedAt, syncBaselineWhenIdle: initialNarrativeUpdatedAt, autoStart: { active: autoStartOnMount, mintedAt: null }, subscribePollerTrigger: true })` + the expired-banner JSX (classes verbatim from the current file).

  ⚠ Auto-start semantics differ from the cards: MemoPoller auto-starts UNCONDITIONALLY on `autoStartOnMount` with `now: Date.now()` and NO mint-anchor check (`MemoPoller.tsx:105-111`). The hook's `autoStart.mintedAt: null` path must reproduce exactly that (null mintedAt ⇒ no expiry pre-check, anchor now) — Task 12 already tests this shape.

- [ ] **Step 2: Run pillar tests** — `npx vitest run "app/(app)/pillar-analysis"` → PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/pillar-analysis/[id]/components/MemoPoller.tsx"
git commit -m "refactor(d1): pillar MemoPoller adopts useMemoPoller (props + behavior unchanged)"
```

### Task 15: KeywordStrategyCard adoption

**Files:**
- Modify: `components/clients/KeywordStrategyCard.tsx`

- [ ] **Step 1: Rewrite the poller wiring onto the hook**, keeping the local-state shell: `useMemoPoller({ topicId: activeSessionId ?? '', onChange: <the current call-time fetchLatestSession + setState block>, fetchLatestUpdatedAt: fetchLatestSession()→s?.memoUpdatedAt (undefined on failure), initialBaseline: initialSession?.memoUpdatedAt ?? null, autoStart: { active: initialSession?.status === 'processing', mintedAt: initialSession?.tokenMintedAt ?? null } })`; onGenerate calls `restart({ baselineNull: true })` + `setActiveSessionId(strategyId)`. Guard: when `activeSessionId` is null, skip subscription (hook accepts empty topicId → no subscribe; add that case to Task 12 tests if missed). The old SSE-handler pre-fetch block (`KeywordStrategyCard.tsx:158-167`) is deleted — SSE goes straight to `machine.invalidate()` via the hook.

- [ ] **Step 2: Run** — `npx vitest run components/clients/KeywordStrategyCard.test.tsx components/handoff` → PASS (A5 suite gates the migration; if a test pinned the pre-fetch behavior, verify it asserts USER-VISIBLE outcome and update only with justification in the commit message).

- [ ] **Step 3: Commit**

```bash
git add components/clients/KeywordStrategyCard.tsx
git commit -m "refactor(d1): KeywordStrategyCard adopts useMemoPoller; vestigial SSE pre-fetch removed (A5 follow-up)"
```

### Task 16: Legacy skill deletion + docs + family-#7 checklist

**Files:**
- Delete: `skills/pillar-analysis-narrative/` (entire dir), `scripts/build-skill.sh`
- Modify: `package.json` (remove `"build:skill"`), `docs/pillar-analysis-handoff.md`, `docs/pillar-prompt-contract.md`, `CLAUDE.md` (Key files: add `lib/handoff/` + `components/handoff/` entries), spec (append "Adding family #7" section)

- [ ] **Step 1: Reference sweep** — `rg "pillar-analysis-narrative|build-skill|build:skill" --glob '!node_modules' --glob '!.next'`; classify every hit: audience-string literals STAY; directory/build references get removed or repointed.

- [ ] **Step 2: Delete + update**

```bash
git rm -r skills/pillar-analysis-narrative scripts/build-skill.sh
```

Remove the `build:skill` line from `package.json` scripts. In the two docs, replace directory references with a dated note pointing at `skills/er-handoff-memo/`. Append to the spec an "Adding family #7" checklist: registry entry (token config + meta + error class + auth policy) → mint/poll routes → GET builder → PATCH route calling `requireHandoffToken` + one-line emit → card wrapper or hook adoption → 2 anchored middleware matchers + `middleware.test.ts` cases → characterization additions (prompt string + auth matrix row) → er-handoff-memo skill routing (release prerequisite).

- [ ] **Step 3: Full gates + smoke** — `npm run lint && npm test && npm run build && npm run smoke` → green.

- [ ] **Step 4: Commit + push + PR + merge + deploy + verify**

```bash
git add package.json docs/pillar-analysis-handoff.md docs/pillar-prompt-contract.md CLAUDE.md docs/superpowers/specs/2026-07-12-d1-handoff-engine-consolidation-design.md
git commit -m "feat(d1): retire pillar-analysis-narrative skill + build wiring; family-7 checklist; PR3 complete"
git push -u origin feat/d1-pr3-cards
gh pr create --title "D1 PR3: useMemoPoller + MemoHandoffCard consolidation; legacy skill retired" --body "..."
```

Post-deploy verify: health ok; authed dashboard loads; a real mint on one family produces a byte-identical clipboard payload (compare against a pre-deploy capture); `memo:` topic literal intact in minified chunks; error log quiet.

### Task 17: Docs ritual (same commit as the PR-3 tracker update, or immediately after merge)

**Files:**
- Modify: `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md` (D1 → `[x]` + dated status-log line), `docs/superpowers/todos/HANDOFF-improvement-roadmap.md` (rewrite)
- Move: spec + this plan to `docs/superpowers/archive/{specs,plans}/` (`git mv`)

- [ ] **Step 1:** Tracker checkbox + status-log line (PR numbers, SHAs, gates, prod-verification evidence) + handoff rewrite in ONE commit; end the chat reply with the paste-in prompt.
