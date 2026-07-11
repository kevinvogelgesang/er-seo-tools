import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import {
  mintKeywordStrategyToken,
  verifyKeywordStrategyToken,
  KeywordStrategyTokenError,
  KEYWORD_STRATEGY_TOKEN_SCOPES,
} from './keyword-strategy-token';
import { mintKeywordMemoToken, verifyKeywordMemoToken } from './keyword-memo-token';

const ORIG_ENV = { ...process.env };
const TEST_SECRET = 'test-secret-keyword-strategy';

describe('keyword-strategy-token', () => {
  beforeEach(() => {
    // Same env var as keyword-memo-token.ts on purpose — the two families
    // deliberately share KEYWORD_MEMO_TOKEN_SECRET; AUDIENCE isolates them.
    process.env = { ...ORIG_ENV, KEYWORD_MEMO_TOKEN_SECRET: TEST_SECRET, NODE_ENV: 'test' };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('mints a kst_-prefixed token and verifies it round-trip', async () => {
    const { token, expiresAt } = await mintKeywordStrategyToken('kss_123');
    expect(token.startsWith('kst_')).toBe(true);
    expect(typeof expiresAt).toBe('string');
    const payload = await verifyKeywordStrategyToken(token, 'kss_123');
    expect(payload.sub).toBe('kss_123');
    expect(payload.scope).toEqual(['read', 'memo-write', 'volume-lookup']);
  });

  it('rejects a token for a different session id (sub mismatch)', async () => {
    const { token } = await mintKeywordStrategyToken('kss_123');
    await expect(verifyKeywordStrategyToken(token, 'kss_999')).rejects.toBeInstanceOf(
      KeywordStrategyTokenError,
    );
  });

  it('rejects a token without the kst_ prefix', async () => {
    await expect(verifyKeywordStrategyToken('pat_whatever', 'kss_123')).rejects.toBeInstanceOf(
      KeywordStrategyTokenError,
    );
  });

  it('rejects an expired token', async () => {
    const secret = new TextEncoder().encode(TEST_SECRET);
    const issuedAt = Math.floor(Date.now() / 1000) - 7200; // 2h ago
    const expiredAt = issuedAt + 3600; // expired 1h ago
    const jwt = await new SignJWT({ scope: ['read', 'memo-write', 'volume-lookup'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('er-seo-tools')
      .setAudience('keyword-strategy-client')
      .setSubject('kss_123')
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiredAt)
      .sign(secret);
    const expiredToken = 'kst_' + jwt;
    await expect(verifyKeywordStrategyToken(expiredToken, 'kss_123')).rejects.toBeInstanceOf(
      KeywordStrategyTokenError,
    );
  });

  it('scope constant contains exactly the three scopes', () => {
    expect(KEYWORD_STRATEGY_TOKEN_SCOPES).toEqual(['read', 'memo-write', 'volume-lookup']);
  });

  describe('cross-family isolation', () => {
    it('rejects a real mintKeywordMemoToken output (prefix mismatch)', async () => {
      const { token } = await mintKeywordMemoToken('km_123');
      await expect(verifyKeywordStrategyToken(token, 'km_123')).rejects.toBeInstanceOf(
        KeywordStrategyTokenError,
      );
    });

    it('rejects a memo token manually re-prefixed kst_ (audience mismatch survives prefix confusion)', async () => {
      const { token } = await mintKeywordMemoToken('km_123');
      const memoJwtBody = token.slice('krt_'.length);
      const reprefixed = 'kst_' + memoJwtBody;
      await expect(verifyKeywordStrategyToken(reprefixed, 'km_123')).rejects.toBeInstanceOf(
        KeywordStrategyTokenError,
      );
    });

    it('rejects a strategy token manually re-prefixed krt_ by verifyKeywordMemoToken', async () => {
      const { token } = await mintKeywordStrategyToken('kss_123');
      const strategyJwtBody = token.slice('kst_'.length);
      const reprefixed = 'krt_' + strategyJwtBody;
      await expect(verifyKeywordMemoToken(reprefixed, 'kss_123')).rejects.toThrow();
    });
  });
});
