import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mintSeoRoadmapToken, verifySeoRoadmapToken, SeoRoadmapTokenError } from './seo-roadmap-token';

const ORIG_ENV = { ...process.env };

describe('seo-roadmap-token', () => {
  beforeEach(() => {
    // Each test sets its own env. Restore in afterEach.
    process.env = { ...ORIG_ENV, SEO_ROADMAP_TOKEN_SECRET: 'test-secret-seo-roadmap', NODE_ENV: 'test' };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('mints a srt_-prefixed token and verifies it round-trip', async () => {
    const { token, expiresAt } = await mintSeoRoadmapToken('rm_123');
    expect(token.startsWith('srt_')).toBe(true);
    expect(typeof expiresAt).toBe('string');
    const payload = await verifySeoRoadmapToken(token, 'rm_123');
    expect(payload.sub).toBe('rm_123');
    expect(payload.scope).toEqual(['read', 'roadmap-write']);
  });

  it('rejects a token for a different roadmap id', async () => {
    const { token } = await mintSeoRoadmapToken('rm_123');
    await expect(verifySeoRoadmapToken(token, 'rm_999')).rejects.toBeInstanceOf(SeoRoadmapTokenError);
  });

  it('rejects a token without the srt_ prefix', async () => {
    await expect(verifySeoRoadmapToken('pat_whatever', 'rm_123')).rejects.toBeInstanceOf(SeoRoadmapTokenError);
  });

  it('rejects a token signed with wrong secret', async () => {
    process.env.SEO_ROADMAP_TOKEN_SECRET = 'secret-A-aaaaaaaaaaaaaaaaaaaaaaaa';
    const { token } = await mintSeoRoadmapToken('rm_123');
    process.env.SEO_ROADMAP_TOKEN_SECRET = 'secret-B-bbbbbbbbbbbbbbbbbbbbbbbb';
    await expect(verifySeoRoadmapToken(token, 'rm_123')).rejects.toBeInstanceOf(SeoRoadmapTokenError);
  });

  it('mint returns expiresAt ~1 hour in the future', async () => {
    const before = Date.now();
    const { expiresAt } = await mintSeoRoadmapToken('rm_123');
    const exp = Date.parse(expiresAt);
    expect(exp).toBeGreaterThan(before + 59 * 60_000);
    expect(exp).toBeLessThan(before + 61 * 60_000);
  });

  it('mint THROWS in production when secret is unset', async () => {
    delete process.env.SEO_ROADMAP_TOKEN_SECRET;
    process.env.NODE_ENV = 'production';
    await expect(mintSeoRoadmapToken('rm_123')).rejects.toBeInstanceOf(SeoRoadmapTokenError);
  });

  it('mint uses dev fallback when NODE_ENV is not production and secret is unset', async () => {
    delete process.env.SEO_ROADMAP_TOKEN_SECRET;
    process.env.NODE_ENV = 'development';
    const { token } = await mintSeoRoadmapToken('rm_123');
    expect(token.startsWith('srt_')).toBe(true);
    // Verify with the same dev fallback
    const claims = await verifySeoRoadmapToken(token, 'rm_123');
    expect(claims.sub).toBe('rm_123');
  });
});
