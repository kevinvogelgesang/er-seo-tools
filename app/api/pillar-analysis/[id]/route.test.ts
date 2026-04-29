import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const findUniqueMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    pillarAnalysis: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

import { GET } from './route';
import { NextRequest } from 'next/server';
import { mintPillarToken } from '@/lib/pillar-token';
import { SignJWT } from 'jose';

const ORIG_ENV = { ...process.env };

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/pillar-analysis/test', {
    method: 'GET',
    headers,
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/pillar-analysis/[id] auth', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    process.env = { ...ORIG_ENV, PILLAR_TOKEN_SECRET: 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaa', NODE_ENV: 'test' };
    findUniqueMock.mockResolvedValue({
      id: 'pa_abc',
      sessionId: 'sess_x',
      status: 'complete',
      error: null,
      score: 8,
      subscores: '{}',
      subscorePresence: null,
      dataCompleteness: 1.0,
      hubRecommendation: '{}',
      pillarTopics: '[]',
      urlVerdicts: '[]',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest(), makeParams('pa_abc'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('auth_missing');
  });

  it('401 when token lacks read scope', async () => {
    // Hand-mint a token with NO scope at all
    const secret = new TextEncoder().encode(process.env.PILLAR_TOKEN_SECRET);
    const noScopeJwt = await new SignJWT({ scope: [] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('er-seo-tools')
      .setAudience('pillar-analysis-narrative')
      .setSubject('pa_abc')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
    const res = await GET(
      makeRequest({ Authorization: `Bearer pat_${noScopeJwt}` }),
      makeParams('pa_abc'),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('token_missing_scope');
  });

  it('200 when token has read scope', async () => {
    const { token } = await mintPillarToken('pa_abc');
    const res = await GET(
      makeRequest({ Authorization: `Bearer ${token}` }),
      makeParams('pa_abc'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('pa_abc');
  });
});
