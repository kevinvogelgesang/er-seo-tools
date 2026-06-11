import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mintQuarterPushToken, verifyQuarterPushToken, QuarterPushTokenError } from './quarter-push-token';

const ORIG_ENV = { ...process.env };

describe('quarter-push-token', () => {
  beforeEach(() => {
    process.env = { ...ORIG_ENV, QUARTER_PUSH_TOKEN_SECRET: 'test-secret-quarter-push', NODE_ENV: 'test' };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('mints a qct_-prefixed token and verifies it round-trip', async () => {
    const { token, expiresAt } = await mintQuarterPushToken('42');
    expect(token.startsWith('qct_')).toBe(true);
    expect(typeof expiresAt).toBe('string');
    const payload = await verifyQuarterPushToken(token, '42');
    expect(payload.sub).toBe('42');
    expect(payload.scope).toEqual(['read', 'receipt-write']);
  });

  it('rejects a token for a different plan id', async () => {
    const { token } = await mintQuarterPushToken('42');
    await expect(verifyQuarterPushToken(token, '43')).rejects.toBeInstanceOf(QuarterPushTokenError);
  });

  it('rejects a token without the qct_ prefix', async () => {
    await expect(verifyQuarterPushToken('srt_whatever', '42')).rejects.toBeInstanceOf(QuarterPushTokenError);
  });

  it('rejects a token signed with wrong secret', async () => {
    process.env.QUARTER_PUSH_TOKEN_SECRET = 'secret-A-aaaaaaaaaaaaaaaaaaaaaaaa';
    const { token } = await mintQuarterPushToken('42');
    process.env.QUARTER_PUSH_TOKEN_SECRET = 'secret-B-bbbbbbbbbbbbbbbbbbbbbbbb';
    await expect(verifyQuarterPushToken(token, '42')).rejects.toBeInstanceOf(QuarterPushTokenError);
  });

  it('mint returns expiresAt ~1 hour in the future', async () => {
    const before = Date.now();
    const { expiresAt } = await mintQuarterPushToken('42');
    const exp = Date.parse(expiresAt);
    expect(exp).toBeGreaterThan(before + 59 * 60_000);
    expect(exp).toBeLessThan(before + 61 * 60_000);
  });

  it('mint THROWS in production when secret is unset', async () => {
    delete process.env.QUARTER_PUSH_TOKEN_SECRET;
    process.env.NODE_ENV = 'production';
    await expect(mintQuarterPushToken('42')).rejects.toBeInstanceOf(QuarterPushTokenError);
  });

  it('mint uses dev fallback when NODE_ENV is not production and secret is unset', async () => {
    delete process.env.QUARTER_PUSH_TOKEN_SECRET;
    process.env.NODE_ENV = 'development';
    const { token } = await mintQuarterPushToken('42');
    expect(token.startsWith('qct_')).toBe(true);
    const claims = await verifyQuarterPushToken(token, '42');
    expect(claims.sub).toBe('42');
  });
});
