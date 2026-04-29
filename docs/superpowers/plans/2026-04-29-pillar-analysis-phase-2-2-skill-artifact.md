# Pillar Analysis Phase 2.2 — Skill Artifact + Narrative Writeback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Claude skill artifact + narrative writeback endpoint as one bundled unit. Skill ingests the clipboard prompt, fetches the analysis, generates a strict 6-section memo, and PATCHes it back to the dashboard for storage.

**Architecture:** Two new backend endpoints (`PATCH /api/pillar-analysis/[id]/narrative` + Bearer-auth tightening on existing `GET /api/pillar-analysis/[id]`). New `skills/pillar-analysis-narrative/` folder with SKILL.md + Python reference scripts + memo template + README. New build script that packages the folder into a distributable ZIP, copying `docs/screaming-frog-setup.md` and `docs/pillar-prompt-contract.md` (single sources of truth) into the skill at build time. New extracted `lib/pillar-prompt.ts` module for `composePayload`/`parsePillarPrompt` so the dashboard button and the skill regex stay in sync via a regression test.

**Tech Stack:** Next.js 15 App Router, Vitest 2.1, jose (already in deps from Phase 2.1). Bash for the build script. Python (stdlib `urllib`) for the reference scripts in the skill.

**Spec:** `docs/superpowers/specs/2026-04-29-pillar-analysis-phase-2-2-skill-artifact-design.md`

**Branch:** `feature/pillar-analysis-phase-1` (continue the running PR; Phase 2 work merges with Phase 1).

---

## File structure

**Create:**
- `lib/pillar-prompt.ts` — `composePayload` + `parsePillarPrompt` + canonical regex
- `lib/pillar-prompt.test.ts` — round-trip regression test
- `app/api/pillar-analysis/[id]/route.test.ts` — auth tightening tests (3)
- `app/api/pillar-analysis/[id]/narrative/route.ts` — PATCH handler
- `app/api/pillar-analysis/[id]/narrative/route.test.ts` — PATCH tests (9)
- `docs/pillar-prompt-contract.md` — single source of truth for prompt format
- `skills/pillar-analysis-narrative/SKILL.md`
- `skills/pillar-analysis-narrative/version.txt`
- `skills/pillar-analysis-narrative/scripts/fetch_analysis.py`
- `skills/pillar-analysis-narrative/scripts/post_narrative.py`
- `skills/pillar-analysis-narrative/templates/memo_structure.md`
- `skills/pillar-analysis-narrative/README.md`
- `scripts/build-skill.sh`

**Modify:**
- `app/api/pillar-analysis/[id]/route.ts` — require Bearer auth + `'read'` scope
- `app/pillar-analysis/[id]/page.tsx` — pass `Authorization` to any client-side fetches (none currently — verify)
- `app/pillar-analysis/[id]/components/CopyClaudePromptButton.tsx` — import `composePayload` from `lib/pillar-prompt.ts` instead of defining inline
- `package.json` — add `build:skill` script
- `.gitignore` — add `dist/` if not present

---

## Pre-flight

1. `cd /Users/kevin/enrollment-resources/Claude/er-seo-tools`
2. Confirm on branch `feature/pillar-analysis-phase-1`: `git branch --show-current`
3. Run baseline `npm test 2>&1 | tail -3` and confirm 873 tests pass.

---

## Task 1: Extract `composePayload` to `lib/pillar-prompt.ts` + add `parsePillarPrompt`

**Files:**
- Create: `lib/pillar-prompt.ts`
- Modify: `app/pillar-analysis/[id]/components/CopyClaudePromptButton.tsx`

This task is the foundation for the regression test (Task 2) and the prompt-contract doc (Task 3). It also makes the parsing regex available to backend code if we ever need it (e.g. server-side prompt validation).

- [ ] **Step 1: Create `lib/pillar-prompt.ts`**

Create the file with this exact content:

```ts
// lib/pillar-prompt.ts
// Canonical composer + parser for the pillar-analysis clipboard prompt.
// Used by the dashboard's CopyClaudePromptButton (compose) and by the
// regression test (parse). The skill (Phase 2.2) documents the same
// regex pattern in its SKILL.md — see docs/pillar-prompt-contract.md
// for the single source of truth.

export interface PillarPromptArgs {
  webappUrl: string;
  analysisId: string;
  token: string;
}

/**
 * Format the clipboard payload that an analyst pastes into Claude.
 * Format is locked — see docs/pillar-prompt-contract.md before changing.
 */
export function composePayload({ webappUrl, analysisId, token }: PillarPromptArgs): string {
  return [
    'Run a pillar analysis narrative on this site.',
    '',
    `Webapp: ${webappUrl}`,
    `Analysis ID: ${analysisId}`,
    `Access token: ${token}`,
    '(Expires in 1h)',
    '',
    'Fetch the structured analysis, write the internal strategic memo, and post it back to the dashboard.',
  ].join('\n');
}

/**
 * Extract the three required fields from a pasted payload. Returns null
 * if any field is missing — the skill activation depends on all three
 * being present. Whitespace tolerant (some clipboard managers / chat UIs
 * normalize line endings).
 */
export interface PillarPromptFields {
  webappUrl: string;
  analysisId: string;
  token: string;
}

export const WEBAPP_URL_REGEX = /^[ \t]*Webapp:[ \t]+(\S+)\s*$/m;
export const ANALYSIS_ID_REGEX = /^[ \t]*Analysis ID:[ \t]+(\S+)\s*$/m;
export const TOKEN_REGEX = /^[ \t]*Access token:[ \t]+(pat_[A-Za-z0-9._-]+)\s*$/m;

export function parsePillarPrompt(text: string): PillarPromptFields | null {
  const webapp = text.match(WEBAPP_URL_REGEX)?.[1];
  const analysisId = text.match(ANALYSIS_ID_REGEX)?.[1];
  const token = text.match(TOKEN_REGEX)?.[1];
  if (!webapp || !analysisId || !token) return null;
  return { webappUrl: webapp, analysisId, token };
}
```

- [ ] **Step 2: Update `CopyClaudePromptButton.tsx` to import `composePayload`**

Open `/Users/kevin/enrollment-resources/Claude/er-seo-tools/app/pillar-analysis/[id]/components/CopyClaudePromptButton.tsx`. Add the import at the top (after the existing imports):

```ts
import { composePayload } from '@/lib/pillar-prompt';
```

Then DELETE the inline `composePayload` function definition (the `function composePayload({...})` block, ~12 lines). Leave the call sites alone — they already invoke `composePayload(...)` and will resolve to the imported version.

- [ ] **Step 3: Verify TS compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: clean.

- [ ] **Step 4: Verify tests still pass**

Run: `npm test 2>&1 | tail -3`
Expected: 873 tests pass (baseline preserved; no new tests yet).

- [ ] **Step 5: Commit**

```bash
git add lib/pillar-prompt.ts 'app/pillar-analysis/[id]/components/CopyClaudePromptButton.tsx'
git commit -m "refactor(pillar): extract composePayload + add parsePillarPrompt to lib/pillar-prompt"
```

---

## Task 2: Prompt-format regression test

**Files:**
- Create: `lib/pillar-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/pillar-prompt.test.ts
import { describe, it, expect } from 'vitest';
import { composePayload, parsePillarPrompt } from './pillar-prompt';

describe('pillar-prompt round-trip', () => {
  it('parsePillarPrompt extracts all three fields from composePayload output', () => {
    const out = composePayload({
      webappUrl: 'https://seo-tools.er.com',
      analysisId: 'pa_abc123',
      token: 'pat_eyJhbGciOiJIUzI1NiJ9.payload.sig',
    });
    const parsed = parsePillarPrompt(out);
    expect(parsed).not.toBeNull();
    expect(parsed!.webappUrl).toBe('https://seo-tools.er.com');
    expect(parsed!.analysisId).toBe('pa_abc123');
    expect(parsed!.token).toBe('pat_eyJhbGciOiJIUzI1NiJ9.payload.sig');
  });

  it('parsePillarPrompt returns null when token missing', () => {
    const out = composePayload({
      webappUrl: 'https://seo-tools.er.com',
      analysisId: 'pa_abc123',
      token: 'pat_x',
    }).replace(/^Access token:.*$/m, '');
    expect(parsePillarPrompt(out)).toBeNull();
  });

  it('parsePillarPrompt returns null when token lacks pat_ prefix', () => {
    const text = composePayload({
      webappUrl: 'https://seo-tools.er.com',
      analysisId: 'pa_abc123',
      token: 'pat_x',
    }).replace('pat_x', 'invalidtoken');
    expect(parsePillarPrompt(text)).toBeNull();
  });

  it('parsePillarPrompt is whitespace-tolerant on field separators', () => {
    // Some clipboard managers may add CRLF or tab variations
    const text = [
      'Run a pillar analysis narrative on this site.',
      '',
      'Webapp:  https://seo-tools.er.com',  // double space
      '\tAnalysis ID:\tpa_abc123',           // tab indented + tab separator
      'Access token:   pat_xyz',             // multiple spaces
      '(Expires in 1h)',
    ].join('\r\n');
    const parsed = parsePillarPrompt(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.webappUrl).toBe('https://seo-tools.er.com');
    expect(parsed!.analysisId).toBe('pa_abc123');
    expect(parsed!.token).toBe('pat_xyz');
  });

  it('composePayload output preserves the documented format', () => {
    const out = composePayload({
      webappUrl: 'https://seo-tools.er.com',
      analysisId: 'pa_abc',
      token: 'pat_xyz',
    });
    expect(out).toContain('Run a pillar analysis narrative on this site.');
    expect(out).toContain('Webapp: https://seo-tools.er.com');
    expect(out).toContain('Analysis ID: pa_abc');
    expect(out).toContain('Access token: pat_xyz');
    expect(out).toContain('(Expires in 1h)');
    expect(out).toContain('Fetch the structured analysis, write the internal strategic memo, and post it back to the dashboard.');
  });
});
```

- [ ] **Step 2: Run, expect pass (test was already running against the newly-extracted module)**

Run: `npx vitest run lib/pillar-prompt.test.ts`
Expected: 5 tests pass.

(If you're following TDD strictly: yes, the test was written *after* the implementation existed in Task 1. That's fine here — the implementation is a refactor of existing working code, not new functionality. The test verifies the contract isn't broken by future changes.)

- [ ] **Step 3: Run the full suite**

Run: `npm test 2>&1 | tail -3`
Expected: 878 tests pass (873 + 5 new).

- [ ] **Step 4: Commit**

```bash
git add lib/pillar-prompt.test.ts
git commit -m "test(pillar): regression test for prompt format round-trip"
```

---

## Task 3: Prompt-format contract doc

**Files:**
- Create: `docs/pillar-prompt-contract.md`

Single source of truth that humans read when they want to understand or modify the format. Cross-referenced from `lib/pillar-prompt.ts`, the SKILL.md (Task 7), and the regression test.

- [ ] **Step 1: Create the doc**

Create `docs/pillar-prompt-contract.md` with this exact content:

```markdown
# Pillar Prompt Format Contract

**Status:** Locked. Do not change without updating ALL of:

1. `lib/pillar-prompt.ts` (`composePayload` + the regex constants).
2. `skills/pillar-analysis-narrative/SKILL.md` (the parsing instructions for Claude).
3. This document.
4. The regression test at `lib/pillar-prompt.test.ts` will catch composer/parser drift, but it cannot detect drift between this doc and either implementation. Manual review during PR is the only safeguard.

## Why a contract

The `composePayload` function on the dashboard button produces a clipboard payload. The skill's SKILL.md tells Claude how to extract three fields from that payload. If either side drifts, the skill silently fails to activate or fails to parse a field. Locking the format here keeps the surface explicit.

## The format

Plain text, exactly:

\`\`\`
Run a pillar analysis narrative on this site.

Webapp: {webappUrl}
Analysis ID: {analysisId}
Access token: {token}
(Expires in 1h)

Fetch the structured analysis, write the internal strategic memo, and post it back to the dashboard.
\`\`\`

Variables:
- `{webappUrl}` — public origin of the er-seo-tools deployment, e.g. `https://seo-tools.er.com`. No trailing slash.
- `{analysisId}` — Prisma cuid for the PillarAnalysis row, e.g. `cmok7ar8300059cdi5h3me91h`.
- `{token}` — JWT prefixed with `pat_`, e.g. `pat_eyJhbGciOiJIUzI1NiJ9.payload.signature`.

## Required fields and parser regex

The skill's parser must extract `webappUrl`, `analysisId`, and `token` from any pasted payload. The regex constants in `lib/pillar-prompt.ts` are the authoritative source:

\`\`\`
^[ \t]*Webapp:[ \t]+(\S+)\s*$
^[ \t]*Analysis ID:[ \t]+(\S+)\s*$
^[ \t]*Access token:[ \t]+(pat_[A-Za-z0-9._-]+)\s*$
\`\`\`

All three regexes use the multi-line flag (`m`). Whitespace tolerance: tabs and spaces are interchangeable around the colon and value; multiple spaces are accepted; leading whitespace is stripped.

## What the skill does with the parsed fields

- `webappUrl` + `analysisId` build the GET URL: `{webappUrl}/api/pillar-analysis/{analysisId}`.
- `token` is sent as the Bearer credential: `Authorization: Bearer {token}`.
- `webappUrl` + `analysisId` build the PATCH URL: `{webappUrl}/api/pillar-analysis/{analysisId}/narrative`.

## What changes are safe vs. unsafe

**Safe (no contract change):**
- Adjusting prose lines (the "Run a pillar analysis…" or "Fetch the structured analysis…" framing) — those are LLM-prompting context and don't have to match a regex.

**Unsafe (requires contract + regex + SKILL.md updates together):**
- Changing the field labels (`Webapp:`, `Analysis ID:`, `Access token:`) — case, spelling, or punctuation.
- Changing the token prefix (`pat_`).
- Adding required fields.
- Reordering: the parsers don't depend on order, but the SKILL.md may. Keep the order documented here.
```

- [ ] **Step 2: Commit**

```bash
git add docs/pillar-prompt-contract.md
git commit -m "docs: lock pillar prompt format contract (single source of truth)"
```

---

## Task 4: Tighten `GET /api/pillar-analysis/[id]` with Bearer auth

**Files:**
- Modify: `app/api/pillar-analysis/[id]/route.ts`
- Create: `app/api/pillar-analysis/[id]/route.test.ts`

The existing GET endpoint shipped public in Phase 1. Adding Bearer auth closes the data-exposure gap. The skill (the only external consumer) already sends the bearer token from the clipboard payload, so this is non-breaking for the actual flow. The dashboard server component uses Prisma directly, not this endpoint, so it's unaffected.

- [ ] **Step 1: Read the existing route**

Run: `cat 'app/api/pillar-analysis/[id]/route.ts'`

You'll see the current GET handler that does `prisma.pillarAnalysis.findUnique` and returns the full structured payload. We're prepending auth to it.

- [ ] **Step 2: Write the failing test**

Create `app/api/pillar-analysis/[id]/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const findUniqueMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    pillarAnalysis: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

import { GET } from './route';
import { NextRequest } from 'next/server';
import { mintPillarToken } from '@/lib/pillar-token';
import { SignJWT } from 'jose';

const ORIG_ENV = { ...process.env };

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/pillar-analysis/test', {
    method: 'GET',
    headers,
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/pillar-analysis/[id] auth', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    process.env = { ...ORIG_ENV, PILLAR_TOKEN_SECRET: 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaa', NODE_ENV: 'test' };
    findUniqueMock.mockResolvedValue({
      id: 'pa_abc',
      sessionId: 'sess_x',
      status: 'complete',
      error: null,
      score: 8,
      subscores: '{}',
      subscorePresence: null,
      dataCompleteness: 1.0,
      hubRecommendation: '{}',
      pillarTopics: '[]',
      urlVerdicts: '[]',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest(), makeParams('pa_abc'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('auth_missing');
  });

  it('401 when token lacks read scope', async () => {
    // Hand-mint a token with NO scope at all
    const secret = new TextEncoder().encode(process.env.PILLAR_TOKEN_SECRET);
    const noScopeJwt = await new SignJWT({ scope: [] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('er-seo-tools')
      .setAudience('pillar-analysis-narrative')
      .setSubject('pa_abc')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
    const res = await GET(
      makeRequest({ Authorization: `Bearer pat_${noScopeJwt}` }),
      makeParams('pa_abc'),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('token_missing_scope');
  });

  it('200 when token has read scope', async () => {
    const { token } = await mintPillarToken('pa_abc');
    const res = await GET(
      makeRequest({ Authorization: `Bearer ${token}` }),
      makeParams('pa_abc'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('pa_abc');
  });
});
```

- [ ] **Step 3: Run, expect first two to fail (third passes since GET currently returns 200 unconditionally)**

Run: `npx vitest run 'app/api/pillar-analysis/[id]/route.test.ts'`
Expected: 2 fail (auth_missing + token_missing_scope return 200 instead of 401), 1 pass.

- [ ] **Step 4: Add auth to the GET handler**

Read the current `app/api/pillar-analysis/[id]/route.ts`. The GET function will look roughly like:

```ts
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pa = await prisma.pillarAnalysis.findUnique({ where: { id } });
  if (!pa) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ /* existing fields */ });
}
```

Replace it with this version that requires Bearer + `read` scope:

```ts
import { verifyPillarToken, PillarTokenError } from '@/lib/pillar-token';

const REQUIRED_SCOPE = 'read';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'auth_missing' }, { status: 401 });
  }
  const match = authHeader.match(/^Bearer\s+(pat_\S+)$/);
  if (!match) {
    return NextResponse.json({ error: 'auth_malformed' }, { status: 401 });
  }
  const token = match[1];

  let payload;
  try {
    payload = await verifyPillarToken(token, id);
  } catch (err) {
    if (err instanceof PillarTokenError) {
      const msg = err.message.toLowerCase();
      const code = msg.includes('expired')
        ? 'token_expired'
        : msg.includes('does not match')
          ? 'token_wrong_analysis_id'
          : msg.includes('signature')
            ? 'token_invalid_signature'
            : 'token_invalid';
      return NextResponse.json({ error: code }, { status: 401 });
    }
    return NextResponse.json({ error: 'token_service_unavailable' }, { status: 500 });
  }

  const scopes = Array.isArray(payload.scope) ? (payload.scope as string[]) : [];
  if (!scopes.includes(REQUIRED_SCOPE)) {
    return NextResponse.json({ error: 'token_missing_scope' }, { status: 401 });
  }

  const pa = await prisma.pillarAnalysis.findUnique({ where: { id } });
  if (!pa) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({
    id: pa.id,
    sessionId: pa.sessionId,
    status: pa.status,
    error: pa.error,
    score: pa.score,
    subscores: pa.subscores ? safeJSON(pa.subscores) : null,
    subscorePresence: pa.subscorePresence ? safeJSON(pa.subscorePresence) : null,
    dataCompleteness: pa.dataCompleteness,
    hubRecommendation: pa.hubRecommendation ? safeJSON(pa.hubRecommendation) : null,
    pillarTopics: pa.pillarTopics ? safeJSON(pa.pillarTopics) : null,
    urlVerdicts: pa.urlVerdicts ? safeJSON(pa.urlVerdicts) : null,
    createdAt: pa.createdAt,
    updatedAt: pa.updatedAt,
  });
}

function safeJSON(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
```

The `safeJSON` helper exists in the current file; if it's already there, keep it. Adjust the response payload to match the existing fields (cross-reference the current GET to confirm). The auth-prepend is the meaningful change.

- [ ] **Step 5: Run the tests, expect all 3 pass**

Run: `npx vitest run 'app/api/pillar-analysis/[id]/route.test.ts'`
Expected: 3 tests pass.

- [ ] **Step 6: Run the full suite**

Run: `npm test 2>&1 | tail -3`
Expected: 881 tests pass (878 + 3 new).

- [ ] **Step 7: Commit**

```bash
git add 'app/api/pillar-analysis/[id]/route.ts' 'app/api/pillar-analysis/[id]/route.test.ts'
git commit -m "feat(pillar): require Bearer token + 'read' scope on GET /api/pillar-analysis/[id]"
```

---

## Task 5: PATCH `/api/pillar-analysis/[id]/narrative` (TDD)

**Files:**
- Create: `app/api/pillar-analysis/[id]/narrative/route.ts`
- Create: `app/api/pillar-analysis/[id]/narrative/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/api/pillar-analysis/[id]/narrative/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const findUniqueMock = vi.fn();
const updateMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    pillarAnalysis: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

import { PATCH } from './route';
import { NextRequest } from 'next/server';
import { mintPillarToken } from '@/lib/pillar-token';
import { SignJWT } from 'jose';

const ORIG_ENV = { ...process.env };

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
  return new NextRequest('http://localhost:3000/api/pillar-analysis/test/narrative', init);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function authHeader(analysisId: string) {
  const { token } = await mintPillarToken(analysisId);
  return { Authorization: `Bearer ${token}` };
}

describe('PATCH /api/pillar-analysis/[id]/narrative', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    updateMock.mockReset();
    process.env = { ...ORIG_ENV, PILLAR_TOKEN_SECRET: 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaa', NODE_ENV: 'test' };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('400 invalid_json on malformed body', async () => {
    const auth = await authHeader('pa_abc');
    const req = new NextRequest('http://localhost:3000/api/pillar-analysis/test/narrative', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: '{not json',
    });
    const res = await PATCH(req, makeParams('pa_abc'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
  });

  it('400 narrative_required when field missing', async () => {
    const auth = await authHeader('pa_abc');
    const res = await PATCH(makeRequest({ otherField: 'x' }, auth), makeParams('pa_abc'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('narrative_required');
  });

  it('400 narrative_too_long when over 50k chars', async () => {
    const auth = await authHeader('pa_abc');
    const big = 'x'.repeat(50_001);
    const res = await PATCH(makeRequest({ narrative: big }, auth), makeParams('pa_abc'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('narrative_too_long');
  });

  it('401 auth_missing when no Authorization header', async () => {
    const res = await PATCH(makeRequest({ narrative: 'memo' }), makeParams('pa_abc'));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_missing');
  });

  it('401 auth_malformed when header is not Bearer', async () => {
    const res = await PATCH(
      makeRequest({ narrative: 'memo' }, { Authorization: 'Basic xyz' }),
      makeParams('pa_abc'),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_malformed');
  });

  it('401 token_wrong_analysis_id when token sub does not match path id', async () => {
    const auth = await authHeader('pa_other');
    const res = await PATCH(makeRequest({ narrative: 'memo' }, auth), makeParams('pa_abc'));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('token_wrong_analysis_id');
  });

  it('401 token_missing_scope when JWT lacks narrative-write scope', async () => {
    // Hand-mint a token with read-only scope
    const secret = new TextEncoder().encode(process.env.PILLAR_TOKEN_SECRET);
    const readOnlyJwt = await new SignJWT({ scope: ['read'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('er-seo-tools')
      .setAudience('pillar-analysis-narrative')
      .setSubject('pa_abc')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
    const res = await PATCH(
      makeRequest({ narrative: 'memo' }, { Authorization: `Bearer pat_${readOnlyJwt}` }),
      makeParams('pa_abc'),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('token_missing_scope');
  });

  it('404 not_found when analysis does not exist', async () => {
    findUniqueMock.mockResolvedValue(null);
    const auth = await authHeader('pa_abc');
    const res = await PATCH(makeRequest({ narrative: 'memo' }, auth), makeParams('pa_abc'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
  });

  it('200 success writes narrative + updatedAt', async () => {
    const fakeUpdatedAt = new Date('2026-04-29T20:00:00Z');
    findUniqueMock.mockResolvedValue({ id: 'pa_abc' });
    updateMock.mockResolvedValue({ id: 'pa_abc', narrativeUpdatedAt: fakeUpdatedAt });
    const auth = await authHeader('pa_abc');
    const res = await PATCH(makeRequest({ narrative: '## 1. Bottom line\n\nWorth it.' }, auth), makeParams('pa_abc'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.updatedAt).toBe(fakeUpdatedAt.toISOString());
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'pa_abc' },
      data: expect.objectContaining({
        aiNarrative: '## 1. Bottom line\n\nWorth it.',
        narrativeUpdatedAt: expect.any(Date),
      }),
    });
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run 'app/api/pillar-analysis/[id]/narrative/route.test.ts'`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement the route**

Create `app/api/pillar-analysis/[id]/narrative/route.ts`:

```ts
// app/api/pillar-analysis/[id]/narrative/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyPillarToken, PillarTokenError } from '@/lib/pillar-token';

const REQUIRED_SCOPE = 'narrative-write';
const MAX_NARRATIVE_CHARS = 50_000;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // 1. Parse + validate body shape (do this before auth so a malformed
  //    request gets a specific 400 instead of a generic 401)
  let body: { narrative?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.narrative !== 'string' || body.narrative.length === 0) {
    return NextResponse.json({ error: 'narrative_required' }, { status: 400 });
  }
  if (body.narrative.length > MAX_NARRATIVE_CHARS) {
    return NextResponse.json({ error: 'narrative_too_long' }, { status: 400 });
  }
  const narrative = body.narrative;

  // 2. Auth header
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'auth_missing' }, { status: 401 });
  }
  const match = authHeader.match(/^Bearer\s+(pat_\S+)$/);
  if (!match) {
    return NextResponse.json({ error: 'auth_malformed' }, { status: 401 });
  }
  const token = match[1];

  // 3. Token verify
  let payload;
  try {
    payload = await verifyPillarToken(token, id);
  } catch (err) {
    if (err instanceof PillarTokenError) {
      const msg = err.message.toLowerCase();
      const code = msg.includes('expired')
        ? 'token_expired'
        : msg.includes('does not match')
          ? 'token_wrong_analysis_id'
          : msg.includes('signature')
            ? 'token_invalid_signature'
            : 'token_invalid';
      return NextResponse.json({ error: code }, { status: 401 });
    }
    return NextResponse.json({ error: 'token_service_unavailable' }, { status: 500 });
  }

  // 4. Scope check
  const scopes = Array.isArray(payload.scope) ? (payload.scope as string[]) : [];
  if (!scopes.includes(REQUIRED_SCOPE)) {
    return NextResponse.json({ error: 'token_missing_scope' }, { status: 401 });
  }

  // 5. Find analysis
  const pa = await prisma.pillarAnalysis.findUnique({ where: { id } });
  if (!pa) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // 6. Update + respond
  const now = new Date();
  const updated = await prisma.pillarAnalysis.update({
    where: { id },
    data: {
      aiNarrative: narrative,
      narrativeUpdatedAt: now,
    },
  });

  return NextResponse.json({
    ok: true,
    updatedAt: (updated.narrativeUpdatedAt ?? now).toISOString(),
  });
}
```

- [ ] **Step 4: Run, expect 9 passing**

Run: `npx vitest run 'app/api/pillar-analysis/[id]/narrative/route.test.ts'`
Expected: 9 tests pass.

- [ ] **Step 5: Run the full suite**

Run: `npm test 2>&1 | tail -3`
Expected: 890 tests pass (881 + 9 new).

- [ ] **Step 6: Commit**

```bash
git add 'app/api/pillar-analysis/[id]/narrative/'
git commit -m "feat(pillar): PATCH /api/pillar-analysis/[id]/narrative endpoint"
```

---

## Task 6: Skill folder scaffold (`version.txt` + empty placeholder files)

**Files:**
- Create: `skills/pillar-analysis-narrative/version.txt`
- Create: `skills/pillar-analysis-narrative/SKILL.md` (empty, filled in Task 7)
- Create: `skills/pillar-analysis-narrative/README.md` (empty, filled in Task 10)
- Create: `skills/pillar-analysis-narrative/scripts/.gitkeep`
- Create: `skills/pillar-analysis-narrative/templates/.gitkeep`

This task makes the directory structure exist so the build script (later) works. Real content lands in subsequent tasks.

- [ ] **Step 1: Create directories**

```bash
cd /Users/kevin/enrollment-resources/Claude/er-seo-tools
mkdir -p skills/pillar-analysis-narrative/scripts
mkdir -p skills/pillar-analysis-narrative/templates
```

- [ ] **Step 2: Create `version.txt`**

```bash
echo "1.0.0" > skills/pillar-analysis-narrative/version.txt
```

- [ ] **Step 3: Create empty `SKILL.md` and `README.md`**

```bash
touch skills/pillar-analysis-narrative/SKILL.md
touch skills/pillar-analysis-narrative/README.md
```

- [ ] **Step 4: Add `.gitkeep` to scripts/ and templates/ so empty dirs are committed**

```bash
touch skills/pillar-analysis-narrative/scripts/.gitkeep
touch skills/pillar-analysis-narrative/templates/.gitkeep
```

- [ ] **Step 5: Commit**

```bash
git add skills/pillar-analysis-narrative/
git commit -m "feat(pillar): scaffold skills/pillar-analysis-narrative folder"
```

---

## Task 7: Write `SKILL.md`

**Files:**
- Modify: `skills/pillar-analysis-narrative/SKILL.md`

This is the spine of the skill — what Claude reads to know how to behave when a payload is pasted.

- [ ] **Step 1: Write the SKILL.md content**

Open `skills/pillar-analysis-narrative/SKILL.md` and write this exact content:

```markdown
---
name: pillar-analysis-narrative
description: |
  Use this when the user pastes a clipboard payload from the er-seo-tools
  Pillar Analysis dashboard. The payload contains the lines "Webapp:",
  "Analysis ID:", and "Access token: pat_..." (a JWT). Fetches the
  structured analysis, writes a strategic memo, and posts it back to
  the dashboard. Internal use only at Enrollment Resources.
version: 1.0.0
---

# Pillar Analysis Narrative

Internal skill for Enrollment Resources analysts. Activates when the user
pastes a payload from the Pillar Analysis dashboard's "Copy Claude Prompt"
button.

## When to activate

The user message must contain ALL of:

- A line matching `Webapp:` followed by a URL
- A line matching `Analysis ID:` followed by a Prisma cuid
- A line matching `Access token: pat_` followed by a JWT

If any field is missing, ask the user to copy a fresh prompt from the
dashboard. Do not attempt the flow with partial fields.

## Execution flow

### 1. Parse the payload

Extract three fields from the user's message:

- `webappUrl` — value after `Webapp:`
- `analysisId` — value after `Analysis ID:`
- `token` — value after `Access token: ` (must start with `pat_`)

Reference parser code: `scripts/fetch_analysis.py` shows the expected
structure. Whitespace tolerance: tabs and multiple spaces around the
colon are fine. The contract is locked at
`docs/pillar-prompt-contract.md` (in the repo) and copied into this
skill at build time.

If any field can't be parsed, reply: "Couldn't parse the prompt — make
sure all three fields are present (Webapp, Analysis ID, Access token).
Click 'Copy Claude Prompt' on the dashboard again to refresh."

### 2. Fetch the structured analysis

Use the Python code execution sandbox to GET
`{webappUrl}/api/pillar-analysis/{analysisId}` with header
`Authorization: Bearer {token}`. The response is the structured analysis
(score, subscores, hub recommendation, pillar topics, URL verdicts).

If the response has a `_status` field (HTTP error from
`scripts/fetch_analysis.py` pattern), map it to a user-facing message:

- `_status: 401, error: token_expired` → "Token expired (1h limit). Refresh er-seo-tools and click Copy Claude Prompt again."
- `_status: 401, error: token_invalid_signature` → "Token signature invalid. Webapp may have been redeployed. Copy a fresh prompt."
- `_status: 401, error: token_wrong_analysis_id` → "Token doesn't match this analysis ID. Did you mix up two clipboard payloads?"
- `_status: 404` → "Analysis not found. Was it deleted?"
- `_status: 0, error: network_error` → "Couldn't reach webapp. Check VPN if remote."

If you got a successful payload, proceed to step 3.

### 3. Read the memo template

Read `templates/memo_structure.md` (in this skill folder) for the strict
6-section schema and the two synthetic example memos. Match the section
names verbatim and respect the per-section length guidance.

### 4. Generate the memo

Write all six sections in markdown:

1. `## 1. Bottom line` — 1–3 sentences. "Worth it" / "Worth it but later" / "Don't bother — fix X first."
2. `## 2. Score interpretation` — 1 paragraph. Explicitly name the weakest subscore.
3. `## 3. Hub recommendation` — 2 paragraphs. Picked format with reasoning + runner-up + how close the call was.
4. `## 4. Pillar topics` — One subsection per cluster (use `### {Cluster name}`). Anchor URL, cluster-page count, topical strength, one risk per cluster.
5. `## 5. Migration sequencing` — 1 paragraph + ordered list.
6. `## 6. Caveats` — Bulleted list. Missing data, low-confidence verdicts, sample-size warnings.

Total target: 600–1000 words.

**Voice:** Internal, blunt. The client never sees this output. Accuracy
matters more than diplomacy. If the analysis says the site isn't ready
for pillar work, say so directly — see Example B in
`templates/memo_structure.md`.

### 5. Post the memo back

PATCH `{webappUrl}/api/pillar-analysis/{analysisId}/narrative` with the
generated memo as the `narrative` field. See `scripts/post_narrative.py`
for the request shape.

If the response has a `_status` error field, map per step 2's table.

### 6. Reply in chat with a one-screen summary

Format:

```
✓ Pillar analysis narrative posted for {site}

Score: {N}/10 — {one-line interpretation}{ — ⚠ {dataCompleteness}% data completeness if <100%}
Hub recommendation: {format} (alternate: {format}, {close call | clear winner})
Pillar topics: {N} clusters identified ({M} cluster pages, {K} leave-as-blog, {P} prune)
Narrative updated: just now

Dashboard: {webappUrl}/pillar-analysis/{analysisId}
```

Keep the chat reply short. The full memo lives in the dashboard.

## Narrative-staleness rule (hard requirement)

If the user asks you to revise the memo within the conversation
("tweak the migration sequence," "make the bottom line harsher"), you
MUST re-run step 5 (PATCH) with the revised memo. The dashboard is the
source of truth — silent in-chat edits leave the dashboard with stale
content.

This is not optional. After every memo revision, PATCH again.

## Errors and fallbacks

If the Python sandbox isn't available in the user's Claude tier, the
HTTP calls will fail. Tell the user: "This skill needs the Python
code-execution tool. If you're on a tier that doesn't have it, the
analyst can manually generate the memo using the structured analysis
JSON visible at the dashboard URL."
```

- [ ] **Step 2: Verify the file written correctly**

Run: `head -20 skills/pillar-analysis-narrative/SKILL.md`
Expected: yaml frontmatter + Pillar Analysis Narrative title.

- [ ] **Step 3: Commit**

```bash
git add skills/pillar-analysis-narrative/SKILL.md
git commit -m "feat(pillar): SKILL.md activation + execution flow"
```

---

## Task 8: Write the strict memo template + 2 synthetic examples

**Files:**
- Create: `skills/pillar-analysis-narrative/templates/memo_structure.md`

This file is the most important content asset for memo quality. It documents the section schema and provides two full-length synthetic example memos that anchor the model's output style.

- [ ] **Step 1: Write the schema + Example A**

Open `skills/pillar-analysis-narrative/templates/memo_structure.md` and start with this content:

```markdown
# Pillar Analysis Memo Template

## Section schema (strict)

The memo MUST contain exactly these six sections, in this order, with
markdown headers exactly as shown:

| # | Header | Length | Content |
|---|---|---|---|
| 1 | `## 1. Bottom line` | 1–3 sentences | "Worth it" / "Worth it but later" / "Don't bother — fix X first" verdict |
| 2 | `## 2. Score interpretation` | 1 paragraph | What the 1–10 means for THIS site. Name the weakest subscore explicitly. |
| 3 | `## 3. Hub recommendation` | 2 paragraphs | Picked format + reasoning + runner-up + how close the call was |
| 4 | `## 4. Pillar topics` | One subsection per cluster | `### {Cluster name}`, anchor URL, page count, topical strength, one risk |
| 5 | `## 5. Migration sequencing` | 1 paragraph + ordered list | First / second / third action items |
| 6 | `## 6. Caveats` | Bulleted list | Missing data, low-confidence verdicts, sample-size warnings |

Total target: 600–1000 words.

## Voice

Internal, blunt. The client NEVER sees this output. Accuracy beats
diplomacy. If the data says "don't pillar this site yet," write that
directly. If a cluster is borderline, say so. If a recommendation is
low-confidence, surface the doubt.

The two examples below model this voice. Mimic their tone, not just
their structure.

---

## Example A — Score 8, anchor-rich career college (confident pillar opportunity)

*Hypothetical client: Mountain Trade Institute, a career college teaching HVAC, electrical, and plumbing across two campuses (Phoenix, Tucson). 187 URLs crawled.*

\`\`\`markdown
## 1. Bottom line

Worth it. The site is sitting on a textbook anchor-rich pillar setup — three substantive program pages, two location pages with regional content, and ~50 blog posts that map cleanly to those anchors. Three program pillars + two location pillars = real upside if the team commits to building out the catchall hub for the orphaned 8 posts.

## 2. Score interpretation

Score 8/10 is a high-confidence "go" call. Content volume (9.2/10) and topical concentration (10/10) are both strong — the site has enough informational depth and the clusters are coherent without being over-fragmented. Existing organic footprint (8.4/10) means there's already latent search demand for the cluster pages to harvest. The weakest subscore is internal-link gap at 4.5 — the site is already moderately well-linked, so pillar work captures less link-equity benefit than on a site with sparse linking. Net: this is a clean retrofit, not a rebuild.

## 3. Hub recommendation

Nest under programs. 87% of clusters are vertical (each maps cleanly to one program), and the program pages already pull informational impressions on terms like "HVAC technician training Phoenix" and "electrician apprenticeship cost." The program pages are commercially-strong with clear program details + apply CTAs, but they currently link sparsely to the supporting blog content. Pillar conversion = wire each program page to its 8–15 cluster pages and add a topical-overview section near the top.

The runner-up is hybrid (vertical clusters under programs, horizontal under /resources/) at score delta 1.8 — close enough that if the team wants to spin up a /resources/ hub for the catchall (financial aid, study tips), that's a defensible call. The fresh-/career-guides/ option scores far behind (delta 5.1) since SERP for these terms is dominated by program-comparison content, not guide-format competitors.

## 4. Pillar topics

### HVAC Technician Training (program: /programs/hvac-technician/)

12 cluster pages. Strong topical coverage spanning licensing, salary, day-in-the-life, certifications. Pillar candidate is the existing program page (high inlinks, ranks for transactional queries already). Risk: 3 of the 12 cluster posts are 4+ years old and reference outdated EPA cert numbers — refresh those before linking to the pillar.

### Electrical Trades (program: /programs/electrical-trades/)

9 cluster pages. Pillar coverage is solid except for a gap on residential vs. commercial career paths — a single new article would close that. Risk: minimal.

### Plumbing (program: /programs/plumbing/)

7 cluster pages. Smallest of the program pillars. Risk: this is the boundary of viable cluster size; if 2 of the 7 posts get pruned for thin content (see §6), the pillar drops below `minClusterSize=3` for any subtopic groupings.

### Phoenix Campus (location: /locations/phoenix/)

5 cluster pages, all blog posts about Phoenix-specific job market / employer partnerships / events. Anchor page is the existing campus page (good inlinks, geo-modifier ranks). Risk: 2 of the 5 are event recap posts that age fast — consider removing time-bound content from the cluster.

### Tucson Campus (location: /locations/tucson/)

3 cluster pages — at the floor for cluster viability. Risk: noted; the cluster is "real" but won't drive significant volume.

### General Resources (catchall)

8 unassigned posts on financial aid, FAFSA tips, study habits. Recommend nesting under a new `/resources/` hub OR splitting between programs (FAFSA → general program landing, study tips → maybe drop). Score-favored option is "rename /blog/ → /resources/" if the existing /blog/ has any backlink authority worth preserving.

## 5. Migration sequencing

Order matters here — start with the highest-confidence, lowest-risk pillars to validate the approach before touching weaker clusters.

1. **HVAC pillar (week 1).** Refresh the 3 outdated posts (EPA cert numbers), then add internal links from each cluster post → program page. Add a topical-overview section to the program page that links DOWN to the 12 cluster pages.
2. **Electrical pillar (week 2).** Same playbook + commission the residential-vs-commercial article to close the topical gap.
3. **Phoenix campus pillar (week 3).** Lower stakes — just the inlinks pass; no new content needed.
4. **Plumbing + Tucson (week 4).** Borderline clusters — measure HVAC's traffic lift before committing to these.
5. **Catchall hub (deferred).** Don't spin up `/resources/` until you've validated the program-pillar approach is delivering. The 8 catchall posts can sit where they are for 90 days.

## 6. Caveats

- Backlink data not uploaded — `backlinkDistribution` defaulted to 5/10 (neutral). If Mountain Trade Institute has a Semrush subscription, re-run the analysis with that export to refine the score and the consolidate verdicts.
- 4 cluster posts are >4 years old and may be ranking on stale terms. Verify before linking from the pillar.
- Tucson cluster is at the `minClusterSize=3` floor — if any of those posts get pruned for any reason, the cluster collapses.
- Anchor-based clustering used `verticalAlignmentThreshold=0.55` (default). On a site this anchor-rich, a slightly higher threshold might tighten cluster assignments — worth tuning if the analyst sees a borderline blog post mis-clustered.
\`\`\`

---

## Example B — Score 4, missing data, pump-the-brakes
```

- [ ] **Step 2: Append Example B**

Continue the same file with Example B (~700 words):

```markdown
*Hypothetical client: Riverside Beauty Academy, a small single-program cosmetology school in a regional market. 64 URLs crawled. No GSC export, no Semrush data.*

\`\`\`markdown
## 1. Bottom line

Don't bother yet. The site doesn't have the topical depth to support a pillar model — only 12 informational posts that mostly fail to cluster, a single program page that's confused commercially-vs-informationally, and ~60% of the score signals are missing because no GSC or Semrush data was provided. Fix the program page first, expand the blog inventory, then re-run this analysis in 6 months.

## 2. Score interpretation

Score 4/10 with `dataCompleteness: 60%` is a soft no. Three of six subscores are real measurements; the other three defaulted to neutral 5.0 because no GSC export and no Semrush data were uploaded. The weakest measured subscore is content volume (2.1/10) — 12 informational posts is below the 15-post floor where pillar models start to make sense. Topical concentration is also weak (3.5) — only 1 cluster of size ≥3 forms, so there's nothing to actually pillar around.

The score being a 4 rather than a 2 is mostly the neutral-default subscores propping it up. If GSC and Semrush data confirm what the structural data already implies, expect this to drop to a 2 or 3.

## 3. Hub recommendation

Fresh `/resources/` hub — but with low confidence. The decision tree picked this because clusters skew horizontal (no clear program-anchor matching) and the existing `/blog/` doesn't have detectable backlink authority worth preserving. Score: 5.4/10. Runner-up is `fresh-career-guides-hub` at 4.1, which would be more defensible IF Riverside had topical content matching career-guide patterns ("how to become an esthetician," "cosmetologist salary"). It doesn't.

The honest read: hub format is moot until the content inventory grows. Recommendation is provisional — re-run after the content expansion in §5 and the answer may shift.

## 4. Pillar topics

### Cosmetology Career Topics (program: /programs/cosmetology/)

3 cluster pages — barely above the `minClusterSize=3` floor. Pillar candidate is the program page. Risk: it's commercially-confused. The page has sections that read transactional ("Apply now") AND informational ("What does a cosmetologist do?"), and the intent classifier flagged it as commercial with low confidence (0.62). Before pillaring, split this into two pages: a clean transactional program landing + a "what is cosmetology" informational hub.

### General Resources (catchall)

7 unassigned posts on miscellaneous topics (industry trends, school stories, alumni interviews). No coherent topic emerges; treat these as standalone blog posts, not cluster fodder.

(Only one anchor cluster of viable size — the rest of the inventory is too thin or too scattered.)

## 5. Migration sequencing

The fastest win is NOT pillaring. Spend the next quarter doing this instead:

1. **Fix the program page.** Split `/programs/cosmetology/` into a transactional landing page + a `/what-is-cosmetology/` hub. Disambiguates intent for both Google and analysts.
2. **Commission 8–10 new informational posts** to push content volume above the 15-post floor. Topics: licensing process by state, salary expectations, day-in-the-life, career paths from cosmetology (esthetician, salon owner, etc.).
3. **Upload GSC and Semrush data** to the next analysis run. Without those signals, half the scoring is guesswork.
4. **Re-run the pillar analysis in 6 months.** If content volume + completeness both move up, the score should land in the 6–8 range and the recommendation becomes actionable.

## 6. Caveats

- **dataCompleteness 60%** — three subscores are neutral defaults, not real measurements. The score is directional only. Re-run with full data before making strategic calls.
- **Single program** means no anchor diversity. If Riverside expands its program catalog, this analysis becomes much more useful.
- **Content inventory below floor.** 12 posts is too thin to support any pillar structure; recommendations are mostly "grow first."
- **Program page commercial-intent confidence is low (0.62)**. Worth a manual review of the page; the classifier may be flagging real ambiguity that hurts both organic ranking and pillar viability.
- **No backlink data** — verdict logic for "leave-as-blog" (singletons with authority) couldn't trigger correctly. Some of the 7 catchall posts may have backlinks that change their classification. Re-run with Semrush data to refine.
\`\`\`
```

- [ ] **Step 3: Verify file structure**

Run: `wc -l skills/pillar-analysis-narrative/templates/memo_structure.md`
Expected: roughly 200+ lines (schema + 2 examples + voice notes).

- [ ] **Step 4: Commit**

```bash
git add skills/pillar-analysis-narrative/templates/memo_structure.md
git commit -m "feat(pillar): strict 6-section memo template + 2 synthetic examples"
```

---

## Task 9: Reference Python scripts

**Files:**
- Create: `skills/pillar-analysis-narrative/scripts/fetch_analysis.py`
- Create: `skills/pillar-analysis-narrative/scripts/post_narrative.py`
- Delete: `skills/pillar-analysis-narrative/scripts/.gitkeep`

- [ ] **Step 1: Create `fetch_analysis.py`**

```python
"""
Reference: GET the structured pillar analysis for the given access token.

The skill model reads this file to understand the API shape, then writes
equivalent code in its code-execution sandbox.
"""
import json
import sys
import urllib.request
import urllib.error

def fetch_analysis(webapp_url: str, analysis_id: str, token: str) -> dict:
    url = f"{webapp_url.rstrip('/')}/api/pillar-analysis/{analysis_id}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        # Surface the structured error body for the skill to map to user-facing copy.
        try:
            body = json.loads(e.read())
        except (ValueError, OSError):
            body = {"error": "unparseable_response"}
        return {"_status": e.code, **body}
    except urllib.error.URLError as e:
        # Network-level failure (DNS, refused, timeout). No structured body.
        return {"_status": 0, "error": "network_error", "reason": str(e.reason)}

if __name__ == "__main__":
    webapp, aid, tok = sys.argv[1], sys.argv[2], sys.argv[3]
    print(json.dumps(fetch_analysis(webapp, aid, tok), indent=2))
```

- [ ] **Step 2: Create `post_narrative.py`**

```python
"""
Reference: PATCH the narrative memo back to the analysis row.
"""
import json
import sys
import urllib.request
import urllib.error

def post_narrative(webapp_url: str, analysis_id: str, token: str, narrative: str) -> dict:
    url = f"{webapp_url.rstrip('/')}/api/pillar-analysis/{analysis_id}/narrative"
    body = json.dumps({"narrative": narrative}).encode()
    req = urllib.request.Request(
        url, data=body, method="PATCH",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read())
        except (ValueError, OSError):
            body = {"error": "unparseable_response"}
        return {"_status": e.code, **body}
    except urllib.error.URLError as e:
        return {"_status": 0, "error": "network_error", "reason": str(e.reason)}

if __name__ == "__main__":
    webapp, aid, tok = sys.argv[1], sys.argv[2], sys.argv[3]
    narrative = sys.stdin.read()
    print(json.dumps(post_narrative(webapp, aid, tok, narrative), indent=2))
```

- [ ] **Step 3: Delete the placeholder**

```bash
rm skills/pillar-analysis-narrative/scripts/.gitkeep
```

- [ ] **Step 4: Verify Python files are valid syntax**

```bash
python3 -m py_compile skills/pillar-analysis-narrative/scripts/fetch_analysis.py
python3 -m py_compile skills/pillar-analysis-narrative/scripts/post_narrative.py
```

Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add skills/pillar-analysis-narrative/scripts/
git commit -m "feat(pillar): reference Python scripts for fetch + post_narrative"
```

---

## Task 10: Write `README.md`

**Files:**
- Modify: `skills/pillar-analysis-narrative/README.md`

- [ ] **Step 1: Write the README**

Open `skills/pillar-analysis-narrative/README.md` and write:

```markdown
# Pillar Analysis Narrative — Skill

Internal Claude skill for Enrollment Resources analysts. Pairs with the
er-seo-tools `/pillar-analysis/[id]` dashboard. Activates when the
analyst pastes a clipboard payload from the dashboard's "Copy Claude
Prompt" button. Generates a strategic memo and posts it back to the
dashboard for storage.

## Install

### Claude Desktop / claude.ai web

1. Build the ZIP: from the er-seo-tools repo root, run `npm run build:skill`.
   Output: `dist/skills/pillar-analysis-narrative-<version>.zip`.
2. In Claude Desktop or claude.ai web: open Customize → Skills → Create skill.
3. Upload the ZIP.
4. Confirm the skill appears in your Skills list and is enabled.

### Claude Code

1. Build the ZIP (same as above).
2. Unzip into the user-skills directory:
   ```bash
   unzip -o dist/skills/pillar-analysis-narrative-*.zip -d ~/.claude/skills/
   ```
3. Restart Claude Code (or trigger a skill index reload) to pick it up.
4. Verify: `ls ~/.claude/skills/pillar-analysis-narrative/` shows
   `SKILL.md`, `version.txt`, `scripts/`, `templates/`, `README.md`.

## Usage

1. Open a complete pillar analysis at `/pillar-analysis/[id]` in
   er-seo-tools.
2. Click "Copy Claude Prompt" in the page header.
3. Paste into Claude (any of the three surfaces).
4. Wait for the skill to fetch the analysis, generate the memo, and PATCH
   it back. The chat reply confirms with a summary + dashboard URL.
5. Reload the dashboard to see the stored memo (Phase 2.3 will render
   it in-page; until then, the memo is in the `aiNarrative` column —
   visible via the GET endpoint or direct DB query).

## Updating the memo

If you ask Claude to revise the memo within the same chat ("tweak the
migration sequence," "make the bottom line harsher"), the skill MUST
re-PATCH the dashboard automatically. This is enforced by SKILL.md.

If you start a new chat, you'll need a fresh prompt — JWT tokens expire
after 1 hour. Just click Copy Claude Prompt again on the dashboard.

## Troubleshooting

- **"Couldn't parse the prompt"** — One or more of `Webapp:`, `Analysis ID:`,
  `Access token:` fields is missing or malformed. Re-copy from the
  dashboard.
- **"Token expired (1h limit)"** — Tokens are short-lived. Re-copy from
  the dashboard.
- **"Token signature invalid"** — Webapp redeployed since the token was
  minted (the signing secret rotated). Re-copy.
- **"Couldn't reach webapp"** — Check VPN if remote, or confirm the
  webapp is running.
- **Skill doesn't activate** — The pasted message must contain literal
  `Analysis ID:` and `pat_` substrings. If you tweaked the format
  manually, restore the original copy from the button.
- **"This skill needs the Python code-execution tool"** — Some Claude
  tiers don't have Python sandbox access. The analyst will need to
  manually generate the memo using the structured analysis JSON visible
  at the dashboard URL.

## Reference docs (copied in by the build script)

- `templates/screaming-frog-setup.md` — full SF setup recipe for the
  three er-seo-tools use cases. Source: `docs/screaming-frog-setup.md`
  in the er-seo-tools repo.
- The prompt format contract (what fields the skill expects) is
  documented at `docs/pillar-prompt-contract.md` in the er-seo-tools
  repo. The build script does NOT copy it into the skill — it's a
  developer-facing doc, not analyst-facing.

## Versioning

Source of truth: `version.txt`. Bump it manually when shipping a new
version of the skill. The build script reads it to name the output ZIP.
```

- [ ] **Step 2: Commit**

```bash
git add skills/pillar-analysis-narrative/README.md
git commit -m "feat(pillar): README for skill install + usage + troubleshooting"
```

---

## Task 11: Build script + npm wiring

**Files:**
- Create: `scripts/build-skill.sh`
- Modify: `package.json` — add `build:skill` script
- Modify: `.gitignore` — add `dist/`

- [ ] **Step 1: Create the build script**

Create `scripts/build-skill.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_SRC="$REPO_ROOT/skills/pillar-analysis-narrative"
SF_DOC="$REPO_ROOT/docs/screaming-frog-setup.md"
DIST_DIR="$REPO_ROOT/dist/skills"
STAGING="$DIST_DIR/pillar-analysis-narrative"

# Version is a single line in version.txt — robust against YAML formatting drift.
VERSION_FILE="$SKILL_SRC/version.txt"
[ -f "$VERSION_FILE" ] || { echo "ERROR: $VERSION_FILE missing" >&2; exit 1; }
VERSION=$(tr -d ' \n\r\t' < "$VERSION_FILE")
[ -n "$VERSION" ] || { echo "ERROR: version.txt is empty" >&2; exit 1; }

# Pre-build sanity loop — fail loud if any expected file is missing.
for f in SKILL.md README.md scripts/fetch_analysis.py scripts/post_narrative.py templates/memo_structure.md; do
  [ -f "$SKILL_SRC/$f" ] || { echo "ERROR: $SKILL_SRC/$f missing" >&2; exit 1; }
done
[ -f "$SF_DOC" ] || { echo "ERROR: $SF_DOC missing (build needs to copy it into the skill)" >&2; exit 1; }

rm -rf "$STAGING"
mkdir -p "$STAGING"
cp -r "$SKILL_SRC"/* "$STAGING/"
cp "$SF_DOC" "$STAGING/templates/screaming-frog-setup.md"

cd "$DIST_DIR"
ZIP_NAME="pillar-analysis-narrative-${VERSION}.zip"
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" "pillar-analysis-narrative/"

echo "Built: $DIST_DIR/$ZIP_NAME"
```

Make it executable:

```bash
chmod +x scripts/build-skill.sh
```

- [ ] **Step 2: Add the npm script**

Open `package.json`. Find the `scripts` section. Add this entry (place it alphabetically among the existing scripts):

```json
"build:skill": "bash scripts/build-skill.sh",
```

The exact location: insert it between `"build"` and the next script alphabetically.

- [ ] **Step 3: Add `dist/` to `.gitignore`**

Open `.gitignore` and add a new line at the bottom (or near other build-output entries):

```
# Built skill ZIPs
dist/
```

(Check if `dist/` is already ignored — if yes, skip this step.)

- [ ] **Step 4: Run the build to verify**

```bash
npm run build:skill
```

Expected output: `Built: /Users/kevin/enrollment-resources/Claude/er-seo-tools/dist/skills/pillar-analysis-narrative-1.0.0.zip`

- [ ] **Step 5: Verify the ZIP contents**

```bash
unzip -l dist/skills/pillar-analysis-narrative-1.0.0.zip
```

Expected: lists `pillar-analysis-narrative/SKILL.md`, `version.txt`, `README.md`, `scripts/fetch_analysis.py`, `scripts/post_narrative.py`, `templates/memo_structure.md`, `templates/screaming-frog-setup.md`. **Seven files.**

- [ ] **Step 6: Verify TS still compiles + tests pass**

```bash
npx tsc --noEmit 2>&1 | tail -5
npm test 2>&1 | tail -3
```

Expected: clean TS, 890 tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-skill.sh package.json .gitignore
git commit -m "feat(pillar): build:skill script packages skill folder + SF doc into ZIP"
```

---

## Task 12: Manual smoke test

**Files:** none (manual validation step).

- [ ] **Step 1: Restart the dev server**

```bash
pkill -f "next dev" 2>&1 || true
cd /Users/kevin/enrollment-resources/Claude/er-seo-tools
npm run dev
```

Wait for `Ready in <Nms>`.

- [ ] **Step 2: Verify the GET endpoint now requires auth**

Find the latest complete pillar analysis id:

```bash
DATABASE_URL='file:./local-dev.db' npx tsx -e "import { prisma } from './lib/db'; prisma.pillarAnalysis.findFirst({where:{status:'complete'},orderBy:{createdAt:'desc'}}).then(p=>console.log(p?.id)).finally(()=>prisma.\$disconnect())"
```

Then test the endpoint without auth (should 401):

```bash
curl -s -w "\n%{http_code}\n" http://localhost:3000/api/pillar-analysis/<id>
```

Expected: `{"error":"auth_missing"}\n401`.

- [ ] **Step 3: Test the PATCH endpoint manually**

In the browser, open `/pillar-analysis/<id>` and click "Copy Claude Prompt". Extract the token from the clipboard. Then in a terminal:

```bash
TOKEN="pat_eyJ..."  # paste the token portion
curl -s -X PATCH http://localhost:3000/api/pillar-analysis/<id>/narrative \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"narrative":"## 1. Bottom line\n\nManual smoke test memo."}'
```

Expected: `{"ok":true,"updatedAt":"<iso>"}`.

Verify the row updated:

```bash
DATABASE_URL='file:./local-dev.db' npx tsx -e "
import { prisma } from './lib/db';
(async () => {
  const p = await prisma.pillarAnalysis.findUnique({ where: { id: '<id>' } });
  console.log('aiNarrative:', p?.aiNarrative);
  console.log('narrativeUpdatedAt:', p?.narrativeUpdatedAt);
  await prisma.\$disconnect();
})();
"
```

Expected: shows the manually-PATCHed memo + a recent timestamp.

- [ ] **Step 4: Install the skill in Claude Desktop**

Build is already done. Take the ZIP at `dist/skills/pillar-analysis-narrative-1.0.0.zip` and upload to Claude Desktop via Customize → Skills → Create skill.

Confirm the skill appears in the list and is enabled.

- [ ] **Step 5: End-to-end via the skill**

Click "Copy Claude Prompt" on the dashboard. Paste into Claude Desktop chat (or claude.ai web). Observe:

- The skill activates (Claude shows it's using the pillar-analysis-narrative skill).
- It fetches the analysis (visible via tool use).
- It generates a 6-section memo following the template.
- It PATCHes the memo back (visible via tool use).
- The chat reply has the one-screen summary format with the dashboard URL.

Then verify in the database:

```bash
DATABASE_URL='file:./local-dev.db' npx tsx -e "
import { prisma } from './lib/db';
(async () => {
  const p = await prisma.pillarAnalysis.findFirst({orderBy:{narrativeUpdatedAt:'desc'}});
  console.log('aiNarrative length:', p?.aiNarrative?.length);
  console.log('updated:', p?.narrativeUpdatedAt);
  await prisma.\$disconnect();
})();
"
```

Expected: `aiNarrative length` is somewhere between 600 and 5000 chars (~600-1000 words ≈ 4000-7000 chars), with a fresh timestamp.

- [ ] **Step 6: Test the narrative-staleness rule**

In the same chat, ask: "Make the bottom line harsher." Claude should regenerate that section AND re-PATCH automatically. Verify the DB reflects the new memo (compare `narrativeUpdatedAt` to the previous one).

- [ ] **Step 7: Note any UX friction**

Capture observations for Phase 2.3:

- Did the skill activate reliably?
- Is the chat-reply summary too long / too short?
- Did the memo follow the template strictly, or did Claude drift?
- Did the staleness rule actually trigger on revision?
- Was there friction in the install flow?

---

## Task 13: Push branch + update PR description

**Files:** none.

- [ ] **Step 1: Push**

```bash
cd /Users/kevin/enrollment-resources/Claude/er-seo-tools
git push
```

Expected: pushes to `origin/feature/pillar-analysis-phase-1`.

- [ ] **Step 2: Update PR description**

Use `gh pr edit 2 --body "..."` to append a "Phase 2.2 (skill artifact + narrative writeback)" section to the existing PR body. Include:

- Summary of what landed (PATCH endpoint, GET auth tightening, skill folder, build script).
- Test count change (873 → 890 = +17 new tests across token regression, GET auth, PATCH auth + body validation).
- Smoke-test status (manual smoke test complete on local dev).
- Out-of-scope items (Phase 2.3 dashboard rendering of the narrative).

- [ ] **Step 3: Stop**

Phase 2.2 is feature-complete. Phase 2.3 (dashboard rendering of `aiNarrative`) is the explicit follow-up.

---

## Self-review

**Spec coverage:**
- §3.1 (PATCH endpoint): Task 5 ✓
- §3.1 (GET auth tightening): Task 4 ✓
- §3.2 (skill folder structure): Tasks 6 + 7 + 8 + 9 + 10 ✓
- §4 (PATCH endpoint design): Task 5 implementation matches §4.1–§4.4 verbatim ✓
- §5 (skill folder structure): Task 6 + Task 9's deletion of .gitkeep ✓
- §6 (SKILL.md content): Task 7 ✓
- §7 (memo template strict + 2 examples): Task 8 ✓
- §8 (fetch_analysis.py with error handling): Task 9 ✓
- §9 (post_narrative.py): Task 9 ✓
- §10 (build script with version.txt + sanity loop): Task 11 ✓
- §11 (README): Task 10 ✓
- §12.1 (PATCH route tests, 9): Task 5 ✓
- §12.2 (GET auth tests, 3): Task 4 ✓
- §12.3 (prompt-contract test): Task 2 ✓
- §13 (acceptance criteria): Task 12 ✓
- §15 (prompt-format contract — single source of truth doc + cross-ref comments + regression test): Task 1 (composePayload extract + cross-ref comment) + Task 2 (regression test) + Task 3 (contract doc) ✓

No spec section without a covering task.

**Placeholder scan:** No `TBD`, `TODO`, `implement later`, "similar to Task N" without code, or "fill in details" patterns. The synthetic memo examples in Task 8 are concrete prose, not placeholders. The smoke-test steps in Task 12 are specific commands.

**Type consistency:**
- `composePayload(args)` and `parsePillarPrompt(text)` shape defined in Task 1, used in Task 2 and (implicitly) by the skill in Task 7.
- `mintPillarToken` and `verifyPillarToken` from Phase 2.1 used in Tasks 4 and 5.
- `PillarTokenError` referenced consistently.
- Error code strings (`auth_missing`, `auth_malformed`, `token_expired`, `token_wrong_analysis_id`, `token_invalid_signature`, `token_invalid`, `token_missing_scope`, `token_service_unavailable`, `narrative_required`, `narrative_too_long`, `not_found`, `invalid_json`) match between PATCH route (Task 5), GET route (Task 4), and SKILL.md error mapping (Task 7).
- Narrative max length 50_000 chars consistent in spec §4.2 + Task 5 implementation + Task 5 test.
- Token format `pat_*` consistent in pillar-token.ts (Phase 2.1), composePayload, parsePillarPrompt regex, and SKILL.md.

No drift detected.
