import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mintKeywordMemoToken, verifyKeywordMemoToken, KeywordMemoTokenError } from './keyword-memo-token';

const ORIG_ENV = { ...process.env };

describe('keyword-memo-token', () => {
  beforeEach(() => {
    // Each test sets its own env. Restore in afterEach.
    process.env = { ...ORIG_ENV, KEYWORD_MEMO_TOKEN_SECRET: 'test-secret-keyword-memo', NODE_ENV: 'test' };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('mints a krt_-prefixed token and verifies it round-trip', async () => {
    const { token, expiresAt } = await mintKeywordMemoToken('km_123');
    expect(token.startsWith('krt_')).toBe(true);
    expect(typeof expiresAt).toBe('string');
    const payload = await verifyKeywordMemoToken(token, 'km_123');
    expect(payload.sub).toBe('km_123');
    expect(payload.scope).toEqual(['read', 'memo-write']);
  });

  it('rejects a token for a different memo id', async () => {
    const { token } = await mintKeywordMemoToken('km_123');
    await expect(verifyKeywordMemoToken(token, 'km_999')).rejects.toBeInstanceOf(KeywordMemoTokenError);
  });

  it('rejects a token without the krt_ prefix', async () => {
    await expect(verifyKeywordMemoToken('pat_whatever', 'km_123')).rejects.toBeInstanceOf(KeywordMemoTokenError);
  });

  it('rejects a token signed with wrong secret', async () => {
    process.env.KEYWORD_MEMO_TOKEN_SECRET = 'secret-A-aaaaaaaaaaaaaaaaaaaaaaaa';
    const { token } = await mintKeywordMemoToken('km_123');
    process.env.KEYWORD_MEMO_TOKEN_SECRET = 'secret-B-bbbbbbbbbbbbbbbbbbbbbbbb';
    await expect(verifyKeywordMemoToken(token, 'km_123')).rejects.toBeInstanceOf(KeywordMemoTokenError);
  });

  it('mint returns expiresAt ~1 hour in the future', async () => {
    const before = Date.now();
    const { expiresAt } = await mintKeywordMemoToken('km_123');
    const exp = Date.parse(expiresAt);
    expect(exp).toBeGreaterThan(before + 59 * 60_000);
    expect(exp).toBeLessThan(before + 61 * 60_000);
  });

  it('mint THROWS in production when secret is unset', async () => {
    delete process.env.KEYWORD_MEMO_TOKEN_SECRET;
    process.env.NODE_ENV = 'production';
    await expect(mintKeywordMemoToken('km_123')).rejects.toBeInstanceOf(KeywordMemoTokenError);
  });

  it('mint uses dev fallback when NODE_ENV is not production and secret is unset', async () => {
    delete process.env.KEYWORD_MEMO_TOKEN_SECRET;
    process.env.NODE_ENV = 'development';
    const { token } = await mintKeywordMemoToken('km_123');
    expect(token.startsWith('krt_')).toBe(true);
    // Verify with the same dev fallback
    const claims = await verifyKeywordMemoToken(token, 'km_123');
    expect(claims.sub).toBe('km_123');
  });
});
