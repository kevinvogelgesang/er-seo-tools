import { describe, it, expect } from 'vitest';
import { isPublicPath } from './middleware';

describe('isPublicPath — auth-gate allowlist', () => {
  // Skill-handoff routes: token-authed at the route level, must bypass the
  // app-password cookie gate. Regression guard for the seo-roadmap/keyword-memo
  // routes that shipped missing from this list (gate returned auth_required
  // before the token verifier ran).
  it.each([
    '/api/pillar-analysis/abc123',
    '/api/pillar-analysis/abc123/narrative',
    '/api/seo-roadmap/abc123',
    '/api/seo-roadmap/abc123/roadmap',
    '/api/keyword-memo/abc123',
    '/api/keyword-memo/abc123/memo',
  ])('exempts token-authed handoff route %s', (p) => {
    expect(isPublicPath(p)).toBe(true);
  });

  it.each([
    '/login',
    '/share/tok',
    '/ada-audit/share/tok',
    '/api/auth/login',
    '/api/share/tok',
    '/favicon.ico',
  ])('exempts known public path %s', (p) => {
    expect(isPublicPath(p)).toBe(true);
  });

  it.each([
    // mint-token + by-session poll are dashboard-triggered → stay cookie-gated
    '/api/seo-roadmap/by-session/sess1/mint-token',
    '/api/seo-roadmap/by-session/sess1',
    '/api/keyword-memo/by-session/sess1/mint-token',
    '/api/keyword-memo/by-session/sess1',
    // ordinary app API surface must remain gated
    '/api/parse/history',
    '/api/seo-parser/sess1/pages',
    '/api/clients',
    '/api/diff',
  ])('keeps non-handoff route %s gated', (p) => {
    expect(isPublicPath(p)).toBe(false);
  });
});
