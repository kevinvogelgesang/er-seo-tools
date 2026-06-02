import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const findUniqueMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    keywordResearchSession: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

import { GET } from './route';
import { NextRequest } from 'next/server';
import { mintKeywordMemoToken } from '@/lib/keyword-memo-token';
import { SignJWT } from 'jose';
import type { AggregatedResult } from '@/lib/types';

const ORIG_ENV = { ...process.env };

const MEMO_ID = 'krt_test_memo_id';
const SESSION_ID = 'sess_test';
const SITE_NAME = 'www.test-school.com';
const TECHNICAL_SESSION_ID = 'tech_sess_123';

/** Minimal AggregatedResult with keyword_signals */
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

const resultWithKeywordSignals: AggregatedResult = {
  ...minimalResult,
  keyword_signals: {
    semrush_connected: true,
    gsc_connected: false,
    ga4_connected: false,
    total_ranking_keywords: 120,
    keyword_cannibalization: [],
    optimization_gaps: [],
    quick_wins: [],
    top_pages_by_organic_traffic: [],
    gap_keywords: [
      {
        keyword: 'online nursing programs',
        volume: 2400,
        kd: 45,
        cpc: 3.2,
        trend: [],
        intent: 'informational',
        competitor_urls: [],
        traffic_share_pct: 12,
        dominant_intent: 'informational',
      },
    ],
  },
};

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000/api/keyword-memo/${MEMO_ID}`, {
    method: 'GET',
    headers,
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/keyword-memo/[id]', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    process.env = {
      ...ORIG_ENV,
      KEYWORD_MEMO_TOKEN_SECRET: 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaa',
      NODE_ENV: 'test',
    };
    // Default: session found with a valid result
    findUniqueMock.mockResolvedValue({
      id: MEMO_ID,
      sessionId: SESSION_ID,
      technicalSessionId: TECHNICAL_SESSION_ID,
      status: 'complete',
      session: {
        id: SESSION_ID,
        siteName: SITE_NAME,
        result: JSON.stringify(minimalResult),
      },
    });
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  // ─── Auth: missing / malformed ───────────────────────────────────────────
  it('401 auth_missing when Authorization header is absent', async () => {
    const res = await GET(makeRequest(), makeParams(MEMO_ID));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_missing');
  });

  it('401 auth_malformed when header is not "Bearer krt_..."', async () => {
    const res = await GET(
      makeRequest({ Authorization: 'Bearer not-a-krt-token' }),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_malformed');
  });

  it('401 auth_malformed when header is Basic scheme', async () => {
    const res = await GET(
      makeRequest({ Authorization: 'Basic abc123' }),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_malformed');
  });

  // ─── Token verification errors ───────────────────────────────────────────
  it('401 token_invalid when a garbage krt_ token is presented', async () => {
    const res = await GET(
      makeRequest({ Authorization: 'Bearer krt_this.is.garbage' }),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('token_invalid');
  });

  it('401 token_wrong_memo_id when token is minted for a different memo id', async () => {
    const { token } = await mintKeywordMemoToken('krt_other_memo_id');
    const res = await GET(
      makeRequest({ Authorization: `Bearer ${token}` }),
      makeParams(MEMO_ID), // different from what the token was minted for
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('token_wrong_memo_id');
  });

  // ─── Scope check ─────────────────────────────────────────────────────────
  it('401 token_missing_scope when token has no scopes', async () => {
    // mintKeywordMemoToken always includes ['read', 'memo-write'], so we hand-craft
    // a structurally valid JWT whose scope array is empty to exercise this branch.
    const secret = new TextEncoder().encode(process.env.KEYWORD_MEMO_TOKEN_SECRET);
    const noScopeJwt = await new SignJWT({ scope: [] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('er-seo-tools')
      .setAudience('keyword-strategy-memo')
      .setSubject(MEMO_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
    const res = await GET(
      makeRequest({ Authorization: `Bearer krt_${noScopeJwt}` }),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('token_missing_scope');
  });

  // ─── DB look-up errors ───────────────────────────────────────────────────
  it('404 not_found when session does not exist', async () => {
    findUniqueMock.mockResolvedValue(null);
    const { token } = await mintKeywordMemoToken(MEMO_ID);
    const res = await GET(
      makeRequest({ Authorization: `Bearer ${token}` }),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
  });

  it('409 session_result_missing when session.result is null', async () => {
    findUniqueMock.mockResolvedValue({
      id: MEMO_ID,
      sessionId: SESSION_ID,
      technicalSessionId: null,
      status: 'pending',
      session: { id: SESSION_ID, siteName: SITE_NAME, result: null },
    });
    const { token } = await mintKeywordMemoToken(MEMO_ID);
    const res = await GET(
      makeRequest({ Authorization: `Bearer ${token}` }),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('session_result_missing');
  });

  // ─── Happy path ──────────────────────────────────────────────────────────
  it('200 returns keyword payload with keyword_signals and technicalSessionId', async () => {
    findUniqueMock.mockResolvedValue({
      id: MEMO_ID,
      sessionId: SESSION_ID,
      technicalSessionId: TECHNICAL_SESSION_ID,
      status: 'complete',
      session: {
        id: SESSION_ID,
        siteName: SITE_NAME,
        result: JSON.stringify(resultWithKeywordSignals),
      },
    });

    const { token } = await mintKeywordMemoToken(MEMO_ID);
    const res = await GET(
      makeRequest({ Authorization: `Bearer ${token}` }),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(MEMO_ID);
    expect(body.sessionId).toBe(SESSION_ID);
    expect(body.technicalSessionId).toBe(TECHNICAL_SESSION_ID);
    expect(body.siteName).toBe(SITE_NAME);
    expect(body.status).toBe('complete');
    expect(body.keyword).toBeDefined();
    expect(body.keyword.keyword_signals).toBeDefined();
    expect(body.keyword.keyword_signals.gap_keywords).toHaveLength(1);
    expect(body.keyword.crawl_summary.total_urls).toBe(10);
  });

  it('200 minimal result (no keyword_signals) still returns valid keyword object', async () => {
    const { token } = await mintKeywordMemoToken(MEMO_ID);
    const res = await GET(
      makeRequest({ Authorization: `Bearer ${token}` }),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keyword).toBeDefined();
    expect(body.keyword.crawl_summary).toBeDefined();
    // no keyword_signals present in minimal result
    expect(body.keyword.keyword_signals).toBeUndefined();
  });

  it('200 technicalSessionId is null when not set on the row', async () => {
    findUniqueMock.mockResolvedValue({
      id: MEMO_ID,
      sessionId: SESSION_ID,
      technicalSessionId: null,
      status: 'complete',
      session: { id: SESSION_ID, siteName: SITE_NAME, result: JSON.stringify(minimalResult) },
    });
    const { token } = await mintKeywordMemoToken(MEMO_ID);
    const res = await GET(
      makeRequest({ Authorization: `Bearer ${token}` }),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.technicalSessionId).toBeNull();
  });
});
