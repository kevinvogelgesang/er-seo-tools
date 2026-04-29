# Pillar Analysis Phase 2.1 — Clipboard Prompt UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the clipboard-prompt UX (button + endpoint + payload format) so the analyst can mint a JWT-signed prompt and copy it from the dashboard or via a deep link from the seo-parser pillar card. Validates Phase 2's UX shape before the skill artifact (Phase 2.2) is built.

**Architecture:** New stateless JWT minting via `jose`, a `POST /api/pillar-analysis/[id]/mint-token` endpoint, a "Copy Claude Prompt" client button that calls the endpoint and writes the payload to the clipboard, and a `#copy-prompt` hash handler so the deep link from the seo-parser card scrolls and highlights the button. Production fail-fast on missing secret via `instrumentation.ts`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5.3, Vitest 2.1, `jose` (new — JWT library, pure JS).

**Spec:** `docs/superpowers/specs/2026-04-29-pillar-analysis-phase-2-1-clipboard-prompt-design.md`

**Branch:** `feature/pillar-analysis-phase-1` (continuing for now; the user is treating Phase 2.1 as a spike before opening a separate Phase 2 branch).

---

## File structure

**Create:**
- `lib/pillar-token.ts` — `mintPillarToken(analysisId)` + `verifyPillarToken(token, expectedAnalysisId)` helpers
- `lib/pillar-token.test.ts` — unit tests
- `app/api/pillar-analysis/[id]/mint-token/route.ts` — POST handler
- `app/api/pillar-analysis/[id]/mint-token/route.test.ts` — route integration tests
- `app/pillar-analysis/[id]/components/CopyClaudePromptButton.tsx` — client component
- `app/pillar-analysis/[id]/components/ClipboardFallbackModal.tsx` — readonly textarea modal fallback
- `app/pillar-analysis/[id]/components/CopyPromptHashHandler.tsx` — handles `#copy-prompt` deep link

**Modify:**
- `package.json` — add `jose` dependency
- `instrumentation.ts` — production fail-fast for missing `PILLAR_TOKEN_SECRET`
- `app/pillar-analysis/[id]/page.tsx` — render the button + hash handler in the header area
- `app/seo-parser/results/[sessionId]/components/PillarAnalysisCardClient.tsx` — add "Generate Claude prompt →" deep-link
- `.env.example` — `PILLAR_TOKEN_SECRET=` placeholder + comment

---

## Pre-flight

1. `cd /Users/kevin/enrollment-resources/Claude/er-seo-tools`
2. Confirm on branch `feature/pillar-analysis-phase-1`: `git branch --show-current`
3. Run baseline `npm test 2>&1 | tail -3` and confirm 862 tests pass.

---

## Task 1: Add `jose` dependency + env var placeholder

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install `jose`**

Run: `npm install jose@^5.9.6`
Expected: `package.json` and `package-lock.json` updated; `jose` appears in `dependencies`.

- [ ] **Step 2: Add `PILLAR_TOKEN_SECRET` to `.env.example`**

Open `.env.example` and append:

```
# Pillar analysis JWT signing secret (REQUIRED in production).
# 32+ random bytes, base64-encoded. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# In dev (NODE_ENV !== 'production'), if unset, a deterministic dev-only
# constant is used and a one-time warning is logged.
PILLAR_TOKEN_SECRET=
```

- [ ] **Step 3: Verify TS still compiles + tests pass**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: clean.

Run: `npm test 2>&1 | tail -3`
Expected: 862 tests pass (baseline unchanged).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore(pillar): add jose dependency + PILLAR_TOKEN_SECRET env var placeholder"
```

---

## Task 2: Pillar token helpers (TDD)

**Files:**
- Create: `lib/pillar-token.ts`
- Create: `lib/pillar-token.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `lib/pillar-token.test.ts` with this exact content:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mintPillarToken, verifyPillarToken, PillarTokenError } from './pillar-token';

const ORIG_ENV = { ...process.env };

describe('pillar-token', () => {
  beforeEach(() => {
    // Each test sets its own env. Restore in afterEach.
    process.env = { ...ORIG_ENV, PILLAR_TOKEN_SECRET: 'test-secret-32-bytes-aaaaaaaaaaaaa', NODE_ENV: 'test' };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('mint + verify round-trips for the same analysisId', async () => {
    const { token } = await mintPillarToken('pa_abc123');
    const claims = await verifyPillarToken(token, 'pa_abc123');
    expect(claims.sub).toBe('pa_abc123');
    expect(claims.aud).toBe('pillar-analysis-narrative');
  });

  it('verify rejects wrong analysisId', async () => {
    const { token } = await mintPillarToken('pa_abc123');
    await expect(verifyPillarToken(token, 'pa_xyz999')).rejects.toBeInstanceOf(PillarTokenError);
  });

  it('verify rejects malformed token', async () => {
    await expect(verifyPillarToken('pat_notarealtoken', 'pa_abc123')).rejects.toBeInstanceOf(PillarTokenError);
  });

  it('verify rejects token signed with wrong secret', async () => {
    process.env.PILLAR_TOKEN_SECRET = 'secret-A-aaaaaaaaaaaaaaaaaaaaaaaa';
    const { token } = await mintPillarToken('pa_abc123');
    process.env.PILLAR_TOKEN_SECRET = 'secret-B-bbbbbbbbbbbbbbbbbbbbbbbb';
    await expect(verifyPillarToken(token, 'pa_abc123')).rejects.toBeInstanceOf(PillarTokenError);
  });

  it('mint returns expiresAt ~1 hour in the future', async () => {
    const before = Date.now();
    const { expiresAt } = await mintPillarToken('pa_abc123');
    const exp = Date.parse(expiresAt);
    expect(exp).toBeGreaterThan(before + 59 * 60_000);
    expect(exp).toBeLessThan(before + 61 * 60_000);
  });

  it('returned token has pat_ prefix', async () => {
    const { token } = await mintPillarToken('pa_abc123');
    expect(token.startsWith('pat_')).toBe(true);
  });

  it('mint THROWS in production when secret is unset', async () => {
    delete process.env.PILLAR_TOKEN_SECRET;
    process.env.NODE_ENV = 'production';
    await expect(mintPillarToken('pa_abc123')).rejects.toBeInstanceOf(PillarTokenError);
  });

  it('mint uses dev fallback when NODE_ENV is not production and secret is unset', async () => {
    delete process.env.PILLAR_TOKEN_SECRET;
    process.env.NODE_ENV = 'development';
    const { token } = await mintPillarToken('pa_abc123');
    expect(token.startsWith('pat_')).toBe(true);
    // Verify with the same dev fallback
    const claims = await verifyPillarToken(token, 'pa_abc123');
    expect(claims.sub).toBe('pa_abc123');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run lib/pillar-token.test.ts`
Expected: FAIL — `Cannot find module './pillar-token'`.

- [ ] **Step 3: Write the implementation**

Create `lib/pillar-token.ts` with this exact content:

```ts
// lib/pillar-token.ts
// Stateless JWT signing/verification for the pillar-analysis clipboard prompt.
// See docs/superpowers/specs/2026-04-29-pillar-analysis-phase-2-1-clipboard-prompt-design.md
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const ISSUER = 'er-seo-tools';
const AUDIENCE = 'pillar-analysis-narrative';
const EXPIRY_SECONDS = 3600; // 1h
const TOKEN_PREFIX = 'pat_';

/**
 * Dev-only fallback secret. Used ONLY when NODE_ENV !== 'production' and
 * the env var is unset. Production paths throw instead of falling back —
 * see getSecret() below.
 */
const DEV_FALLBACK_SECRET = 'dev-pillar-token-secret-do-not-use-in-prod';

let didWarnAboutDevFallback = false;

export class PillarTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PillarTokenError';
  }
}

function getSecret(): Uint8Array {
  const env = process.env.PILLAR_TOKEN_SECRET;
  if (env && env.length > 0) {
    return new TextEncoder().encode(env);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new PillarTokenError(
      'PILLAR_TOKEN_SECRET is required in production and is unset. Refusing to mint or verify tokens.',
    );
  }
  if (!didWarnAboutDevFallback) {
    // eslint-disable-next-line no-console
    console.warn(
      '[pillar-token] PILLAR_TOKEN_SECRET unset; using dev fallback. Set the env var in production.',
    );
    didWarnAboutDevFallback = true;
  }
  return new TextEncoder().encode(DEV_FALLBACK_SECRET);
}

export interface MintedToken {
  token: string;       // includes the 'pat_' prefix
  expiresAt: string;   // ISO 8601
}

export async function mintPillarToken(analysisId: string): Promise<MintedToken> {
  const secret = getSecret();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + EXPIRY_SECONDS;

  const jwt = await new SignJWT({ scope: ['read', 'narrative-write'] })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(analysisId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(secret);

  return {
    token: TOKEN_PREFIX + jwt,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

export async function verifyPillarToken(
  token: string,
  expectedAnalysisId: string,
): Promise<JWTPayload> {
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new PillarTokenError('token missing pat_ prefix');
  }
  const jwt = token.slice(TOKEN_PREFIX.length);

  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(jwt, getSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    payload = verified.payload;
  } catch (err) {
    throw new PillarTokenError(
      `token verification failed: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }

  if (payload.sub !== expectedAnalysisId) {
    throw new PillarTokenError(
      `token sub (${payload.sub}) does not match expected analysis id (${expectedAnalysisId})`,
    );
  }

  return payload;
}
```

- [ ] **Step 4: Run the tests, expect 8 passing**

Run: `npx vitest run lib/pillar-token.test.ts`
Expected: 8 tests pass.

- [ ] **Step 5: Run the full suite**

Run: `npm test 2>&1 | tail -3`
Expected: 870 tests pass (862 + 8 new).

- [ ] **Step 6: Commit**

```bash
git add lib/pillar-token.ts lib/pillar-token.test.ts
git commit -m "feat(pillar): JWT mint/verify helpers with prod fail-fast + dev fallback"
```

---

## Task 3: Production fail-fast in `instrumentation.ts`

**Files:**
- Modify: `instrumentation.ts`

- [ ] **Step 1: Read the existing file**

Open `/Users/kevin/enrollment-resources/Claude/er-seo-tools/instrumentation.ts` and locate the `register()` function. The check goes inside the `if (process.env.NEXT_RUNTIME === 'nodejs')` block, near the top — before any other initialization.

- [ ] **Step 2: Add the startup check**

Inside `register()`, immediately after the existing `if (typeof globalThis.File === 'undefined') { ... }` polyfill block, insert:

```ts
    // Fail fast in production if the pillar token signing secret is missing.
    // The mint/verify helpers also throw on use, but failing at startup makes
    // deployment misconfiguration loud rather than silent. Dev environments
    // continue with a logged warning + deterministic fallback (see pillar-token.ts).
    if (process.env.NODE_ENV === 'production' && !process.env.PILLAR_TOKEN_SECRET) {
      // eslint-disable-next-line no-console
      console.error(
        '[startup] PILLAR_TOKEN_SECRET is required in production but is unset. Refusing to start.',
      );
      process.exit(1);
    }
```

- [ ] **Step 3: Verify TS compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: clean.

- [ ] **Step 4: Verify dev startup still works**

Run (in a separate terminal or background): `npm run dev`
Expected: server starts, no fatal exit, warning from `[pillar-token]` may appear on first mint (that's fine — only logs once).

Kill the dev server if you started it: `pkill -f "next dev"` or just Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add instrumentation.ts
git commit -m "feat(pillar): production fail-fast on missing PILLAR_TOKEN_SECRET"
```

---

## Task 4: Mint-token API route (TDD)

**Files:**
- Create: `app/api/pillar-analysis/[id]/mint-token/route.ts`
- Create: `app/api/pillar-analysis/[id]/mint-token/route.test.ts`

The route returns 404 if the analysis doesn't exist, 409 if it isn't `complete`, 200 with `{ token, expiresAt }` on success.

- [ ] **Step 1: Write the failing test**

Create `app/api/pillar-analysis/[id]/mint-token/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock prisma so we don't need a DB. We mock @/lib/db at the module-import level.
const findUniqueMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    pillarAnalysis: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

import { POST } from './route';
import { NextRequest } from 'next/server';

const ORIG_ENV = { ...process.env };

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/pillar-analysis/test/mint-token', {
    method: 'POST',
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/pillar-analysis/[id]/mint-token', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    process.env = { ...ORIG_ENV, PILLAR_TOKEN_SECRET: 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaa', NODE_ENV: 'test' };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('404 when analysis not found', async () => {
    findUniqueMock.mockResolvedValue(null);
    const res = await POST(makeRequest(), makeParams('pa_missing'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not_found');
  });

  it('409 when analysis is not complete', async () => {
    findUniqueMock.mockResolvedValue({ id: 'pa_running', status: 'running' });
    const res = await POST(makeRequest(), makeParams('pa_running'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('not_complete');
    expect(body.status).toBe('running');
  });

  it('200 with token + expiresAt on success', async () => {
    findUniqueMock.mockResolvedValue({ id: 'pa_complete', status: 'complete' });
    const res = await POST(makeRequest(), makeParams('pa_complete'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toMatch(/^pat_/);
    expect(typeof body.expiresAt).toBe('string');
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run 'app/api/pillar-analysis/[id]/mint-token/route.test.ts'`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement the route**

Create `app/api/pillar-analysis/[id]/mint-token/route.ts`:

```ts
// app/api/pillar-analysis/[id]/mint-token/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { mintPillarToken, PillarTokenError } from '@/lib/pillar-token';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const pa = await prisma.pillarAnalysis.findUnique({ where: { id } });
  if (!pa) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (pa.status !== 'complete') {
    return NextResponse.json(
      { error: 'not_complete', status: pa.status },
      { status: 409 },
    );
  }

  try {
    const minted = await mintPillarToken(pa.id);
    return NextResponse.json(minted);
  } catch (err) {
    if (err instanceof PillarTokenError) {
      // eslint-disable-next-line no-console
      console.error('[pillar-token] mint failed:', err.message);
      return NextResponse.json(
        { error: 'token_service_unavailable' },
        { status: 500 },
      );
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run the tests, expect 3 passing**

Run: `npx vitest run 'app/api/pillar-analysis/[id]/mint-token/route.test.ts'`
Expected: 3 tests pass.

- [ ] **Step 5: Run the full suite**

Run: `npm test 2>&1 | tail -3`
Expected: 873 tests pass (870 + 3 new).

- [ ] **Step 6: Commit**

```bash
git add 'app/api/pillar-analysis/[id]/mint-token/'
git commit -m "feat(pillar): POST /api/pillar-analysis/[id]/mint-token endpoint"
```

---

## Task 5: Clipboard fallback modal component

**Files:**
- Create: `app/pillar-analysis/[id]/components/ClipboardFallbackModal.tsx`

This is the textarea-readonly modal shown when `navigator.clipboard.writeText` is unavailable. It auto-selects on mount and offers a "Copy" button using `document.execCommand('copy')`.

- [ ] **Step 1: Write the component**

Create the file with:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  payload: string;
  onClose: () => void;
}

export function ClipboardFallbackModal({ payload, onClose }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Auto-select the payload so Cmd+C / Ctrl+C just works.
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  const tryExecCopy = () => {
    if (!textareaRef.current) return;
    textareaRef.current.select();
    try {
      const ok = document.execCommand('copy');
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // User can manually Cmd+C; nothing else to do.
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="clipboard-fallback-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-navy-card rounded-xl shadow-lg border border-gray-100 dark:border-navy-border p-6 max-w-2xl w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="clipboard-fallback-title"
          className="font-display font-bold text-lg text-[#1c2d4a] dark:text-white mb-2"
        >
          Copy Claude prompt
        </h2>
        <p className="text-sm text-gray-600 dark:text-white/70 mb-3">
          Your browser blocked automatic clipboard access. Press Cmd+C / Ctrl+C with the
          text below selected, or use the Copy button.
        </p>
        <textarea
          ref={textareaRef}
          readOnly
          value={payload}
          className="w-full h-48 p-3 font-mono text-xs bg-gray-50 dark:bg-navy-deep dark:text-white border border-gray-200 dark:border-navy-border rounded resize-none"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={tryExecCopy}
            className="px-4 py-2 bg-[#f5a623] text-[#1c2d4a] font-medium text-sm rounded hover:bg-[#e8971a]"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 dark:border-navy-border text-gray-700 dark:text-white/80 text-sm rounded hover:bg-gray-50 dark:hover:bg-navy-card/60"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add 'app/pillar-analysis/[id]/components/ClipboardFallbackModal.tsx'
git commit -m "feat(pillar): clipboard fallback modal with auto-select textarea"
```

---

## Task 6: CopyClaudePromptButton component

**Files:**
- Create: `app/pillar-analysis/[id]/components/CopyClaudePromptButton.tsx`

The button that mints, composes, copies, and flashes a confirmation. Falls back to the modal when `navigator.clipboard?.writeText` is undefined.

- [ ] **Step 1: Write the component**

Create the file with:

```tsx
'use client';

import { useState } from 'react';
import { ClipboardFallbackModal } from './ClipboardFallbackModal';

interface Props {
  analysisId: string;
  status: string; // 'pending' | 'running' | 'complete' | 'error'
  webappUrl: string;
}

type ButtonState = 'idle' | 'minting' | 'copied' | 'mint-failed' | 'service-error';

const STATE_LABELS: Record<ButtonState, string> = {
  idle: 'Copy Claude Prompt',
  minting: 'Minting…',
  copied: 'Copied!',
  'mint-failed': 'Mint failed — retry',
  'service-error': 'Token service unavailable',
};

const STATE_CLASSES: Record<ButtonState, string> = {
  idle: 'bg-[#f5a623] text-[#1c2d4a] hover:bg-[#e8971a]',
  minting: 'bg-gray-300 text-gray-600 cursor-wait',
  copied: 'bg-green-500 text-white',
  'mint-failed': 'bg-red-500 text-white',
  'service-error': 'bg-red-700 text-white',
};

function composePayload({ webappUrl, analysisId, token }: { webappUrl: string; analysisId: string; token: string }): string {
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

export function CopyClaudePromptButton({ analysisId, status, webappUrl }: Props) {
  const [state, setState] = useState<ButtonState>('idle');
  const [fallbackPayload, setFallbackPayload] = useState<string | null>(null);

  const disabled = status !== 'complete' || state === 'minting';

  const onClick = async () => {
    if (disabled) return;
    setState('minting');
    try {
      const res = await fetch(`/api/pillar-analysis/${analysisId}/mint-token`, {
        method: 'POST',
      });
      if (res.status === 500) {
        setState('service-error');
        setTimeout(() => setState('idle'), 4000);
        return;
      }
      if (!res.ok) {
        setState('mint-failed');
        setTimeout(() => setState('idle'), 3000);
        return;
      }
      const { token } = (await res.json()) as { token: string };
      const payload = composePayload({ webappUrl, analysisId, token });

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(payload);
          setState('copied');
          setTimeout(() => setState('idle'), 2000);
        } catch {
          // Permission denied or some other clipboard failure — fall back to modal.
          setFallbackPayload(payload);
          setState('idle');
        }
      } else {
        setFallbackPayload(payload);
        setState('idle');
      }
    } catch {
      setState('mint-failed');
      setTimeout(() => setState('idle'), 3000);
    }
  };

  const tooltip = status !== 'complete'
    ? `Available once analysis completes (current status: ${status})`
    : '';

  return (
    <>
      <button
        id="copy-prompt"
        onClick={onClick}
        disabled={disabled}
        title={tooltip}
        className={`px-4 py-2 text-sm font-medium rounded transition-colors ${
          disabled ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : STATE_CLASSES[state]
        }`}
      >
        {disabled && state === 'idle' ? 'Copy Claude Prompt' : STATE_LABELS[state]}
      </button>
      {fallbackPayload && (
        <ClipboardFallbackModal
          payload={fallbackPayload}
          onClose={() => setFallbackPayload(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add 'app/pillar-analysis/[id]/components/CopyClaudePromptButton.tsx'
git commit -m "feat(pillar): CopyClaudePromptButton — mints, copies, falls back to modal"
```

---

## Task 7: Hash-handler component

**Files:**
- Create: `app/pillar-analysis/[id]/components/CopyPromptHashHandler.tsx`

Triggers when the dashboard loads with `#copy-prompt` in the URL: scrolls the button into view and applies a brief pulse highlight.

- [ ] **Step 1: Write the component**

Create the file with:

```tsx
'use client';

import { useEffect } from 'react';

/**
 * If the page loads with #copy-prompt in the URL (deep link from the seo-parser
 * pillar card), scroll the Copy Claude Prompt button into view and pulse it
 * briefly so the analyst knows where to click.
 */
export function CopyPromptHashHandler() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#copy-prompt') return;

    // Wait one tick so the button has rendered.
    const timer = setTimeout(() => {
      const el = document.getElementById('copy-prompt');
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-4', 'ring-orange-300', 'transition-shadow');
      setTimeout(() => el.classList.remove('ring-4', 'ring-orange-300'), 2200);
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  return null;
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add 'app/pillar-analysis/[id]/components/CopyPromptHashHandler.tsx'
git commit -m "feat(pillar): CopyPromptHashHandler — scrolls + highlights button on deep link"
```

---

## Task 8: Wire the button + hash handler into the dashboard page

**Files:**
- Modify: `app/pillar-analysis/[id]/page.tsx`

Add the button to the page header (right of or under the title) and mount the hash handler.

- [ ] **Step 1: Read the current page**

Open the file and locate the `<header>` block. The exact JSX uses an h1 + subtitle structure. The button should sit to the right of the title row (or under, if the row gets crowded).

- [ ] **Step 2: Update imports**

Add at the top of the file (after the existing imports):

```ts
import { CopyClaudePromptButton } from './components/CopyClaudePromptButton';
import { CopyPromptHashHandler } from './components/CopyPromptHashHandler';
```

- [ ] **Step 3: Determine the webapp URL**

Inside the page component (server component, so this is server-side code), define:

```ts
const webappUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
```

Place this near the existing JSON-parse statements (e.g., next to `const subscores = JSON.parse(...)`).

- [ ] **Step 4: Render the button + handler**

Update the `<header>` block to a flex layout that puts the title on the left and the button on the right. Find the existing header JSX (looks roughly like `<header className="border-b pb-4 dark:border-navy-border">`) and modify it to:

```tsx
      <header className="border-b pb-4 dark:border-navy-border flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-[#1c2d4a] dark:text-white">
            {siteName} — Pillar Analysis
          </h1>
          <p className="text-gray-500 dark:text-white/50 text-sm mt-1">
            {/* existing subtitle content stays here, do not modify */}
          </p>
          {/* if a "Back to SEO Audit" link existed here, leave it */}
        </div>
        <CopyClaudePromptButton
          analysisId={pa.id}
          status={pa.status}
          webappUrl={webappUrl}
        />
      </header>
      <CopyPromptHashHandler />
```

The `{/* existing subtitle ... */}` and `{/* if a "Back to SEO Audit" ... */}` comments are placeholders — keep whatever subtitle/back-link JSX is already there. Don't replace it.

- [ ] **Step 5: Verify TS compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: clean.

- [ ] **Step 6: Verify tests pass**

Run: `npm test 2>&1 | tail -3`
Expected: 873 tests still pass (no new tests in this task).

- [ ] **Step 7: Commit**

```bash
git add 'app/pillar-analysis/[id]/page.tsx'
git commit -m "feat(pillar): wire CopyClaudePromptButton + hash handler into dashboard"
```

---

## Task 9: Add deep-link to the seo-parser pillar card

**Files:**
- Modify: `app/seo-parser/results/[sessionId]/components/PillarAnalysisCardClient.tsx`

In the `complete` state render (where the "Open dashboard →" link lives), add a small secondary link below the dashboard button: `Generate Claude prompt →` linking to `/pillar-analysis/{id}#copy-prompt`.

- [ ] **Step 1: Read the existing file**

Open the file and locate the JSX block for `status === 'complete'`. There's already a `<Link href={\`/pillar-analysis/${pa.id}\`} ...>Open dashboard →</Link>`.

- [ ] **Step 2: Restructure the right side of the complete state**

Wrap the existing "Open dashboard →" link in a flex column so a second link can sit below it. The pattern:

```tsx
<div className="flex flex-col items-end gap-1">
  <Link
    href={`/pillar-analysis/${pa.id}`}
    className="rounded bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400 text-white px-4 py-2 text-sm font-medium whitespace-nowrap"
  >
    Open dashboard →
  </Link>
  <Link
    href={`/pillar-analysis/${pa.id}#copy-prompt`}
    className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
  >
    Generate Claude prompt →
  </Link>
</div>
```

Replace the existing single-Link wrapper in the complete state with the above. Leave the rest of the card body (score, completeness, hub recommendation) untouched.

- [ ] **Step 3: Verify TS compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: clean.

- [ ] **Step 4: Verify tests pass**

Run: `npm test 2>&1 | tail -3`
Expected: 873 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add 'app/seo-parser/results/[sessionId]/components/PillarAnalysisCardClient.tsx'
git commit -m "feat(pillar): add 'Generate Claude prompt' deep-link to seo-parser card"
```

---

## Task 10: Manual smoke test

**Files:** none (manual validation step).

- [ ] **Step 1: Restart the dev server**

```bash
pkill -f "next dev" 2>&1 || true
cd /Users/kevin/enrollment-resources/Claude/er-seo-tools
npm run dev
```

Wait for `Ready in <Nms>` log line.

- [ ] **Step 2: Open the dashboard for an existing complete analysis**

In a browser, open `http://localhost:3000/pillar-analysis/<id>` for the latest complete analysis. (Find the id with `DATABASE_URL='file:./local-dev.db' npx tsx -e "import { prisma } from './lib/db'; prisma.pillarAnalysis.findFirst({where:{status:'complete'},orderBy:{createdAt:'desc'}}).then(p=>console.log(p?.id))"`.)

- [ ] **Step 3: Click "Copy Claude Prompt"**

Expected:
- Button briefly shows "Minting…", then flashes "Copied!" green for 2 seconds, then reverts to "Copy Claude Prompt".
- Pasting into a text editor reveals the formatted payload with `Webapp:`, `Analysis ID:`, `Access token: pat_eyJ...`, `(Expires in 1h)`, etc.

- [ ] **Step 4: Decode the JWT**

Paste the `eyJ...` portion of the token (without the `pat_` prefix) into https://jwt.io. Verify:
- `iss === "er-seo-tools"`
- `aud === "pillar-analysis-narrative"`
- `sub` matches the analysis id from the payload
- `exp` is ~1 hour ahead of now

- [ ] **Step 5: Test the deep link**

Open `http://localhost:3000/seo-parser/results/<sessionId>` for the corresponding session. Click "Generate Claude prompt →".
Expected: browser navigates to `/pillar-analysis/<id>#copy-prompt`. The button is highlighted with a brief orange ring, then fades.

- [ ] **Step 6: Test the disabled state**

Open a session whose pillar analysis is `running` or `error`, OR temporarily set status manually via Prisma. Visit the dashboard.
Expected: button is greyed out, hover shows the tooltip "Available once analysis completes (current status: ...)".

- [ ] **Step 7: Test the clipboard fallback**

In Chrome DevTools console, run:
```js
delete navigator.clipboard;
```
(Or open the page over plain HTTP — but localhost is fine, so the simulated delete is the easiest path.)

Reload, click the button.
Expected: the modal opens, payload visible in a textarea, "Copy" button uses execCommand and shows "Copied!", "Close" dismisses.

- [ ] **Step 8: Note any UX friction**

Observations to capture for Phase 2.2:
- Is the button's placement right, or does the header feel crowded?
- Does the deep-link from the seo-parser card feel discoverable?
- Does the payload have the right shape for a skill activation regex?
- Did anything fail unexpectedly?

(No code change in this task — just observations to feed Phase 2.2 design.)

---

## Task 11: Push the branch + offer review

**Files:** none.

- [ ] **Step 1: Push**

```bash
git push
```

Expected: pushes to `origin/feature/pillar-analysis-phase-1`. PR #2 picks up the new commits automatically.

- [ ] **Step 2: Update the PR description (optional)**

If the user wants Phase 2.1 reflected in the existing PR body, edit it to add a "Phase 2.1 (clipboard prompt UX) appended" subsection. Otherwise leave the existing description and rely on the commit log.

- [ ] **Step 3: Stop**

Phase 2.1 is feature-complete. The skill side (Phase 2.2) and the narrative writeback (Phase 2.3) are explicit follow-ups.

---

## Self-review

**Spec coverage:**
- §3.1 (mint-token endpoint): Task 4 ✓
- §3.2 (button + secondary link): Tasks 6 + 8 + 9 ✓
- §4 (JWT design): Task 2 (`mintPillarToken` config) ✓
- §5 (secret management + prod fail-fast): Task 1 (env) + Task 2 (fallback logic) + Task 3 (startup check) ✓
- §6 (payload format): Task 6 (`composePayload`) — exact format from spec, verbatim string template ✓
- §7.1 (button states + accessibility): Task 6 (state machine + aria title) ✓
- §7.2 (deep link + hash): Task 7 + Task 9 ✓
- §7.3 (error states + clipboard fallback modal): Task 5 (modal) + Task 6 (fallback wiring) ✓
- §8 (file table): each row maps to a task above ✓
- §9 (tests): Task 2 (8 token unit tests, including the prod-fail-fast and dev-fallback ones) + Task 4 (3 route integration tests) ✓
- §10 (acceptance criteria): Task 10 manual smoke test ✓

No spec section without a covering task.

**Placeholder scan:** No `TBD`, `TODO`, `implement later`, "similar to Task N", or non-code descriptions of what to do. The two `{/* ... */}` markers in Task 8's diff are explicit "leave existing JSX as-is" comments, not placeholders for new code.

**Type consistency:**
- `mintPillarToken(analysisId)` returns `{ token: string; expiresAt: string }` — same shape used in route (Task 4) and consumed by the button (Task 6).
- `PillarTokenError` defined in Task 2 and used in Task 4 import.
- `CopyClaudePromptButton` props (`analysisId`, `status`, `webappUrl`) match what the page passes in Task 8.
- `ClipboardFallbackModal` props (`payload`, `onClose`) match the consumer in Task 6.

No drift detected.
