// lib/handoff/token.test.ts
// Behavioral parity tests for createHandoffTokenFamily() against the
// per-family constants in lib/handoff/registry.ts. Ported from
// lib/pillar-token.test.ts (pat_ is the representative family exercised for
// the general mint/verify contract) plus factory-specific cases: exact
// message templating per config (subNoun / secretEnv / devFallbackWarnPrefix)
// and cross-family audience isolation for the three families sharing
// KEYWORD_MEMO_TOKEN_SECRET.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SignJWT } from 'jose';

import { createHandoffTokenFamily } from './token';
import { HANDOFF_TOKEN_CONFIGS } from './registry';
import { PillarTokenError, KeywordStrategyTokenError, ContentAuditTokenError } from './errors';

const ORIG_ENV = { ...process.env };

const PAT_SECRET = 'test-secret-pat-32-bytes-aaaaaaaaaa';
const SHARED_SECRET = 'test-secret-shared-krt-kst-cat-bbbbbb';

describe('createHandoffTokenFamily (pat_ as the representative family)', () => {
  const patFamily = createHandoffTokenFamily(HANDOFF_TOKEN_CONFIGS.pat);

  beforeEach(() => {
    process.env = { ...ORIG_ENV, PILLAR_TOKEN_SECRET: PAT_SECRET, NODE_ENV: 'test' };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('mint returns a token with the config prefix and a full claim set (iss/aud/sub/scope/exp)', async () => {
    const before = Math.floor(Date.now() / 1000);
    const { token, expiresAt } = await patFamily.mint('pa_abc123');
    expect(token.startsWith('pat_')).toBe(true);

    const payload = await patFamily.verify(token, 'pa_abc123');
    expect(payload.iss).toBe('er-seo-tools');
    expect(payload.aud).toBe('pillar-analysis-narrative');
    expect(payload.sub).toBe('pa_abc123');
    expect(payload.scope).toEqual(['read', 'narrative-write']);
    expect(payload.exp).toBeGreaterThanOrEqual(before + 3600);
    expect(payload.exp).toBeLessThan(before + 3610);

    const exp = Date.parse(expiresAt);
    expect(exp).toBeGreaterThan(Date.now() + 59 * 60_000);
    expect(exp).toBeLessThan(Date.now() + 61 * 60_000);
  });

  it('verify round-trips a valid token', async () => {
    const { token } = await patFamily.mint('pa_abc123');
    const payload = await patFamily.verify(token, 'pa_abc123');
    expect(payload.sub).toBe('pa_abc123');
  });

  it('verify rejects a token missing the family prefix, with the exact message', async () => {
    let caught: unknown;
    try {
      await patFamily.verify('notarealtoken', 'pa_abc123');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PillarTokenError);
    expect((caught as Error).message).toBe('token missing pat_ prefix');
  });

  it('verify rejects an expired token, wrapping the jose message verbatim (pinned wart: does NOT contain "expired")', async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({ scope: ['read', 'narrative-write'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('er-seo-tools')
      .setAudience('pillar-analysis-narrative')
      .setSubject('pa_abc123')
      .setIssuedAt(now - 7200)
      .setExpirationTime(now - 3600)
      .sign(new TextEncoder().encode(PAT_SECRET));
    const token = 'pat_' + jwt;

    let caught: unknown;
    try {
      await patFamily.verify(token, 'pa_abc123');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PillarTokenError);
    const message = (caught as Error).message;
    expect(message.startsWith('token verification failed: ')).toBe(true);
    expect(message).not.toContain('expired');
    expect(message).toContain('"exp" claim timestamp check failed');
  });

  it('verify rejects wrong sub with the exact subNoun message', async () => {
    const { token } = await patFamily.mint('pa_abc123');
    let caught: unknown;
    try {
      await patFamily.verify(token, 'pa_xyz999');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PillarTokenError);
    expect((caught as Error).message).toBe(
      'token sub (pa_abc123) does not match expected analysis id (pa_xyz999)',
    );
  });

  it('verify wraps a bad-signature jose error', async () => {
    process.env.PILLAR_TOKEN_SECRET = 'secret-A-aaaaaaaaaaaaaaaaaaaaaaaa';
    const { token } = await patFamily.mint('pa_abc123');
    process.env.PILLAR_TOKEN_SECRET = 'secret-B-bbbbbbbbbbbbbbbbbbbbbbbb';

    let caught: unknown;
    try {
      await patFamily.verify(token, 'pa_abc123');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PillarTokenError);
    const message = (caught as Error).message;
    expect(message.startsWith('token verification failed: ')).toBe(true);
    expect(message).toContain('signature');
  });

  it('mint throws in production when the secret is unset, with the exact templated message', async () => {
    delete process.env.PILLAR_TOKEN_SECRET;
    process.env.NODE_ENV = 'production';
    let caught: unknown;
    try {
      await patFamily.mint('pa_abc123');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PillarTokenError);
    expect((caught as Error).message).toBe(
      'PILLAR_TOKEN_SECRET is required in production and is unset. Refusing to mint or verify tokens.',
    );
  });

  it('warns once per family (exact text) and uses the dev fallback when the secret is unset outside production', async () => {
    delete process.env.PILLAR_TOKEN_SECRET;
    process.env.NODE_ENV = 'development';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { token } = await patFamily.mint('pa_abc123');
      expect(token.startsWith('pat_')).toBe(true);

      // Mint a second time in the same test: the warn-once flag must not
      // fire again (module-level Map keyed by config.prefix persists across
      // calls, not just within one mint/verify pair).
      await patFamily.mint('pa_def456');

      const payload = await patFamily.verify(token, 'pa_abc123');
      expect(payload.sub).toBe('pa_abc123');

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        '[pillar-token] PILLAR_TOKEN_SECRET unset; using dev fallback. Set the env var in production.',
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('cross-family audience isolation (kst_ / cat_ share KEYWORD_MEMO_TOKEN_SECRET)', () => {
  const kstFamily = createHandoffTokenFamily(HANDOFF_TOKEN_CONFIGS.kst);
  const catFamily = createHandoffTokenFamily(HANDOFF_TOKEN_CONFIGS.cat);

  beforeEach(() => {
    process.env = { ...ORIG_ENV, KEYWORD_MEMO_TOKEN_SECRET: SHARED_SECRET, NODE_ENV: 'test' };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('a kst_ token presented to cat_ verify rejects on the PREFIX wall first', async () => {
    const { token } = await kstFamily.mint('sess_1');
    let caught: unknown;
    try {
      await catFamily.verify(token, 'sess_1');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ContentAuditTokenError);
    expect((caught as Error).message).toBe('token missing cat_ prefix');
  });

  it('a kst_ token forged with the cat_ prefix still rejects on the AUDIENCE wall (prefix wall bypassed)', async () => {
    const { token } = await kstFamily.mint('sess_1');
    const rawJwt = token.slice('kst_'.length);
    const forged = 'cat_' + rawJwt;

    let caught: unknown;
    try {
      await catFamily.verify(forged, 'sess_1');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ContentAuditTokenError);
    const message = (caught as Error).message;
    expect(message.startsWith('token verification failed: ')).toBe(true);
    expect(message).not.toContain('prefix');
  });

  it('a cat_ token forged with the kst_ prefix rejects on the AUDIENCE wall too (reverse direction)', async () => {
    const { token } = await catFamily.mint('sa_1');
    const rawJwt = token.slice('cat_'.length);
    const forged = 'kst_' + rawJwt;

    let caught: unknown;
    try {
      await kstFamily.verify(forged, 'sa_1');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(KeywordStrategyTokenError);
    const message = (caught as Error).message;
    expect(message.startsWith('token verification failed: ')).toBe(true);
    expect(message).not.toContain('prefix');
  });
});
