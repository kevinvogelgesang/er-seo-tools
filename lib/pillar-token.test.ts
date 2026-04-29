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
