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
    '/api/quarter-plan/push/42',
    '/api/quarter-plan/push/42/receipt',
    '/api/keyword-strategy/abc123',
    '/api/keyword-strategy/abc123/memo',
    '/api/keyword-strategy/abc123/volumes',
  ])('exempts token-authed handoff route %s', (p) => {
    expect(isPublicPath(p)).toBe(true);
  });

  it.each([
    '/login',
    '/share/tok',
    '/ada-audit/share/tok',
    '/ada-audit/site/share/tok',
    '/api/auth/login',
    '/api/auth/google/start', // OAuth handshake start — pre-session, must be public
    '/api/auth/google/callback', // OAuth handshake callback — pre-session, must be public
    '/api/share/tok',
    '/favicon.ico',
    '/privacy', // public privacy policy for Google OAuth verification
    '/about', // public about/home page for Google OAuth consent screen
  ])('exempts known public path %s', (p) => {
    expect(isPublicPath(p)).toBe(true);
  });

  it.each([
    // mint-token + by-session poll are dashboard-triggered → stay cookie-gated
    '/api/seo-roadmap/by-session/sess1/mint-token',
    '/api/seo-roadmap/by-session/sess1',
    '/api/keyword-memo/by-session/sess1/mint-token',
    '/api/keyword-memo/by-session/sess1',
    '/api/quarter-plan/push/mint-token', // dashboard-triggered → cookie-gated
    '/api/quarter-plan', // grid PUT/GET stays gated
    '/api/quarter-plan/activity',
    // ordinary app API surface must remain gated
    '/api/parse/history',
    '/api/seo-parser/sess1/pages',
    '/api/clients',
    '/api/diff',
    // C2 schedule CRUD is dashboard-triggered → not public (gated by omission)
    '/api/clients/7/schedules',
    '/api/clients/7/schedules/abc123',
    // C4 share-mint route is dashboard-triggered → stays cookie-gated
    '/api/site-audit/abc/share',
    // C11: the seoOnly POST only changed the request body shape, not the
    // route's path or auth class — /api/site-audit stays cookie-gated like
    // every other site-audit route (no new isPublicPath entry for this PR).
    '/api/site-audit',
    '/api/site-audit/abc123',
    // C8 settings routes are dashboard-triggered → stays cookie-gated
    '/api/settings/scoring-weights',
    // A8 PR 3.5 fleet-aggregate routes feed the homepage widgets → cookie-gated by omission
    '/api/fleet/kpi',
    '/api/fleet/needs-attention',
    // C11 PR3: the renamed SEO tool surface is authed exactly like /seo-parser was.
    '/seo-audits',
    '/seo-audits/results/run/abc',
    // KS-5: mint-token + by-session poll are dashboard-triggered → stay cookie-gated
    '/api/clients/1/keyword-strategy',
    '/api/clients/1/keyword-strategy/mint-token',
    // anchoring proof: a deeper path than the volumes route must not match
    '/api/keyword-strategy/abc123/volumes/extra',
    // A5 SSE stream — cookie-gated, must NOT be public
    '/api/events',
  ])('keeps non-handoff route %s gated', (p) => {
    expect(isPublicPath(p)).toBe(false);
  });
});

describe('isPublicPath — C14 sales public matchers', () => {
  it('C14: sales public matchers', () => {
    expect(isPublicPath('/sales/3f9c2f4e-aaaa-bbbb-cccc-000000000000')).toBe(true);
    expect(isPublicPath('/api/sales/tok/screenshot/child1/color-contrast-0.png')).toBe(true);
    // the intake page + APIs stay gated
    expect(isPublicPath('/sales')).toBe(false);
    expect(isPublicPath('/api/sales/prospects')).toBe(false);
    expect(isPublicPath('/api/sales/prospects/3/scan')).toBe(false);
    // C14 hero route: public, anchored, single-segment only
    expect(isPublicPath('/api/sales/tok/hero/aud1')).toBe(true);
    // deeper paths + the bare prefix stay gated (negative anchoring proof)
    expect(isPublicPath('/api/sales/tok/hero/aud1/extra')).toBe(false);
    expect(isPublicPath('/api/sales/tok/hero')).toBe(false);
  });
});

describe('isPublicPath — A4 health endpoint', () => {
  it('exempts exactly /api/health', () => {
    expect(isPublicPath('/api/health')).toBe(true);
  });
  it('does NOT exempt a deeper health path (future detail stays gated)', () => {
    expect(isPublicPath('/api/health/detail')).toBe(false);
  });
  it('keeps /admin/ops gated', () => {
    expect(isPublicPath('/admin/ops')).toBe(false);
  });
});

describe('content-audit (cat_) public paths', () => {
  it('the three public routes are public', () => {
    expect(isPublicPath('/api/content-audit/audit_1/manifest')).toBe(true)
    expect(isPublicPath('/api/content-audit/audit_1/page')).toBe(true)
    expect(isPublicPath('/api/content-audit/audit_1/findings')).toBe(true)
  })
  it('a deeper path is NOT public', () => {
    expect(isPublicPath('/api/content-audit/audit_1/manifest/extra')).toBe(false)
    expect(isPublicPath('/api/content-audit')).toBe(false)
  })
  it('the mint + poll routes stay cookie-gated (not public)', () => {
    expect(isPublicPath('/api/site-audit/audit_1/content-audit')).toBe(false)
    expect(isPublicPath('/api/site-audit/audit_1/content-audit/mint-token')).toBe(false)
  })
});

describe('isPublicPath — D8 weekly sweep /issues (Task 12)', () => {
  it('GET /api/issues stays cookie-gated (no isPublicPath entry added)', () => {
    expect(isPublicPath('/api/issues')).toBe(false)
  })
});
