import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const findUniqueMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    seoRoadmap: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

import { GET } from './route';
import { NextRequest } from 'next/server';
import { mintSeoRoadmapToken } from '@/lib/seo-roadmap-token';
import { SignJWT } from 'jose';
import type { AggregatedResult } from '@/lib/types';

const ORIG_ENV = { ...process.env };

const ROADMAP_ID = 'srt_test_roadmap_id';
const SESSION_ID = 'sess_test';
const SITE_NAME = 'www.test-school.com';

/** Minimal AggregatedResult that satisfies buildTechnicalAuditExport */
const minimalResult: AggregatedResult = {
  crawl_summary: { total_urls: 10, indexable_urls: 8, non_indexable_urls: 2 },
  issues: { critical: [], warnings: [], notices: [] },
  site_structure: {
    crawl_depth_distribution: { 0: 1, 1: 9 },
    internal_link_distribution: {},
  },
  resources: {},
  technical_seo: {},
  performance: {},
  recommendations: [],
  metadata: {
    files_processed: [],
    parsers_used: [],
    total_parsers_available: 0,
    health_score: 50,
  },
};

/** AggregatedResult with structured_recommendations present */
const resultWithStructuredRecs: AggregatedResult = {
  ...minimalResult,
  structured_recommendations: [
    {
      issueType: 'broken_internal_links',
      severity: 'critical',
      count: 5,
      effort: 'low',
      fixGuidance: 'Fix all broken internal links.',
      affectedUrlRefs: [1, 2],
      affectedUrlCount: 2,
      affectedUrlComplete: true,
      affectedSetHash: 'abc123',
    },
  ],
};

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000/api/seo-roadmap/${ROADMAP_ID}`, {
    method: 'GET',
    headers,
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/seo-roadmap/[id]', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    process.env = {
      ...ORIG_ENV,
      SEO_ROADMAP_TOKEN_SECRET: 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaa',
      NODE_ENV: 'test',
    };
    // Default: roadmap found with a valid session result and a client with teamworkTasklistId
    findUniqueMock.mockResolvedValue({
      id: ROADMAP_ID,
      sessionId: SESSION_ID,
      status: 'complete',
      session: {
        id: SESSION_ID,
        siteName: SITE_NAME,
        result: JSON.stringify(minimalResult),
        client: { teamworkTasklistId: 'tl_123' },
      },
    });
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  // ─── Auth: missing / malformed ───────────────────────────────────────────
  it('401 auth_missing when Authorization header is absent', async () => {
    const res = await GET(makeRequest(), makeParams(ROADMAP_ID));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_missing');
  });

  it('401 auth_malformed when header is not "Bearer srt_..."', async () => {
    const res = await GET(
      makeRequest({ Authorization: 'Bearer not-an-srt-token' }),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_malformed');
  });

  it('401 auth_malformed when header is Basic scheme', async () => {
    const res = await GET(
      makeRequest({ Authorization: 'Basic abc123' }),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_malformed');
  });

  // ─── Token verification errors ───────────────────────────────────────────
  it('401 token_invalid when a garbage srt_ token is presented', async () => {
    const res = await GET(
      makeRequest({ Authorization: 'Bearer srt_this.is.garbage' }),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('token_invalid');
  });

  it('401 token_wrong_roadmap_id when token is minted for a different roadmap id', async () => {
    const { token } = await mintSeoRoadmapToken('srt_other_roadmap_id');
    const res = await GET(
      makeRequest({ Authorization: `Bearer ${token}` }),
      makeParams(ROADMAP_ID), // different from what the token was minted for
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('token_wrong_roadmap_id');
  });

  // ─── Scope check ─────────────────────────────────────────────────────────
  it('401 token_missing_scope when token has no scopes', async () => {
    // mintSeoRoadmapToken always includes ['read', 'roadmap-write'], so we hand-craft
    // a structurally valid JWT whose scope array is empty to exercise this branch.
    const secret = new TextEncoder().encode(process.env.SEO_ROADMAP_TOKEN_SECRET);
    const noScopeJwt = await new SignJWT({ scope: [] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('er-seo-tools')
      .setAudience('seo-audit-roadmap')
      .setSubject(ROADMAP_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
    const res = await GET(
      makeRequest({ Authorization: `Bearer srt_${noScopeJwt}` }),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('token_missing_scope');
  });

  // ─── DB look-up errors ───────────────────────────────────────────────────
  it('404 not_found when roadmap does not exist', async () => {
    findUniqueMock.mockResolvedValue(null);
    const { token } = await mintSeoRoadmapToken(ROADMAP_ID);
    const res = await GET(
      makeRequest({ Authorization: `Bearer ${token}` }),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
  });

  it('409 session_result_missing when session.result is null', async () => {
    findUniqueMock.mockResolvedValue({
      id: ROADMAP_ID,
      sessionId: SESSION_ID,
      status: 'pending',
      session: { id: SESSION_ID, siteName: SITE_NAME, result: null, client: null },
    });
    const { token } = await mintSeoRoadmapToken(ROADMAP_ID);
    const res = await GET(
      makeRequest({ Authorization: `Bearer ${token}` }),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('session_result_missing');
  });

  // ─── Happy path ──────────────────────────────────────────────────────────
  it('200 returns audit with url_registry and page_index for a valid token + result', async () => {
    const resultWithRegistry: AggregatedResult = {
      ...minimalResult,
      url_registry: {
        sessionOrigin: { scheme: 'https', host: SITE_NAME },
        hosts: [SITE_NAME],
        urls: [
          { id: 0, kind: 'page' as const, hostId: 0, scheme: 'https', path: '/' },
        ],
      },
      page_index: [
        {
          ref: 0,
          title: 'Home',
          h1: 'Welcome',
          metaDescription: 'Home page',
          wordCount: 400,
          crawlDepth: 0,
          indexable: true,
          issueTypes: [],
        },
      ],
    };
    findUniqueMock.mockResolvedValue({
      id: ROADMAP_ID,
      sessionId: SESSION_ID,
      status: 'complete',
      session: {
        id: SESSION_ID,
        siteName: SITE_NAME,
        result: JSON.stringify(resultWithRegistry),
      },
    });

    const { token } = await mintSeoRoadmapToken(ROADMAP_ID);
    const res = await GET(
      makeRequest({ Authorization: `Bearer ${token}` }),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(ROADMAP_ID);
    expect(body.sessionId).toBe(SESSION_ID);
    expect(body.siteName).toBe(SITE_NAME);
    expect(body.status).toBe('complete');
    expect(body.audit).toBeDefined();
    expect(body.audit.url_registry).toBeDefined();
    expect(body.audit.page_index).toBeDefined();
    expect(body.audit.page_index).toHaveLength(1);
  });

  it('200 minimal result (no url_registry) still returns valid audit object', async () => {
    const { token } = await mintSeoRoadmapToken(ROADMAP_ID);
    const res = await GET(
      makeRequest({ Authorization: `Bearer ${token}` }),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.audit).toBeDefined();
    expect(body.audit.crawl_summary).toBeDefined();
    expect(body.audit.issues).toBeDefined();
    expect(body.audit).not.toHaveProperty('keyword_signals');
  });
});
