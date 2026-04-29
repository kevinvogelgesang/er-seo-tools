import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const findUniqueMock = vi.fn();
const updateMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    pillarAnalysis: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

import { PATCH } from './route';
import { NextRequest } from 'next/server';
import { mintPillarToken } from '@/lib/pillar-token';
import { SignJWT } from 'jose';

const ORIG_ENV = { ...process.env };

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
  return new NextRequest('http://localhost:3000/api/pillar-analysis/test/narrative', init);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function authHeader(analysisId: string) {
  const { token } = await mintPillarToken(analysisId);
  return { Authorization: `Bearer ${token}` };
}

describe('PATCH /api/pillar-analysis/[id]/narrative', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    updateMock.mockReset();
    process.env = { ...ORIG_ENV, PILLAR_TOKEN_SECRET: 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaa', NODE_ENV: 'test' };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('400 invalid_json on malformed body', async () => {
    const auth = await authHeader('pa_abc');
    const req = new NextRequest('http://localhost:3000/api/pillar-analysis/test/narrative', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: '{not json',
    });
    const res = await PATCH(req, makeParams('pa_abc'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
  });

  it('400 narrative_required when field missing', async () => {
    const auth = await authHeader('pa_abc');
    const res = await PATCH(makeRequest({ otherField: 'x' }, auth), makeParams('pa_abc'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('narrative_required');
  });

  it('400 narrative_too_long when over 50k chars', async () => {
    const auth = await authHeader('pa_abc');
    const big = 'x'.repeat(50_001);
    const res = await PATCH(makeRequest({ narrative: big }, auth), makeParams('pa_abc'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('narrative_too_long');
  });

  it('401 auth_missing when no Authorization header', async () => {
    const res = await PATCH(makeRequest({ narrative: 'memo' }), makeParams('pa_abc'));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_missing');
  });

  it('401 auth_malformed when header is not Bearer', async () => {
    const res = await PATCH(
      makeRequest({ narrative: 'memo' }, { Authorization: 'Basic xyz' }),
      makeParams('pa_abc'),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_malformed');
  });

  it('401 token_wrong_analysis_id when token sub does not match path id', async () => {
    const auth = await authHeader('pa_other');
    const res = await PATCH(makeRequest({ narrative: 'memo' }, auth), makeParams('pa_abc'));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('token_wrong_analysis_id');
  });

  it('401 token_missing_scope when JWT lacks narrative-write scope', async () => {
    // Hand-mint a token with read-only scope
    const secret = new TextEncoder().encode(process.env.PILLAR_TOKEN_SECRET);
    const readOnlyJwt = await new SignJWT({ scope: ['read'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('er-seo-tools')
      .setAudience('pillar-analysis-narrative')
      .setSubject('pa_abc')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
    const res = await PATCH(
      makeRequest({ narrative: 'memo' }, { Authorization: `Bearer pat_${readOnlyJwt}` }),
      makeParams('pa_abc'),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('token_missing_scope');
  });

  it('404 not_found when analysis does not exist', async () => {
    findUniqueMock.mockResolvedValue(null);
    const auth = await authHeader('pa_abc');
    const res = await PATCH(makeRequest({ narrative: 'memo' }, auth), makeParams('pa_abc'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
  });

  it('200 success writes narrative + updatedAt', async () => {
    const fakeUpdatedAt = new Date('2026-04-29T20:00:00Z');
    findUniqueMock.mockResolvedValue({ id: 'pa_abc' });
    updateMock.mockResolvedValue({ id: 'pa_abc', narrativeUpdatedAt: fakeUpdatedAt });
    const auth = await authHeader('pa_abc');
    const res = await PATCH(makeRequest({ narrative: '## 1. Bottom line\n\nWorth it.' }, auth), makeParams('pa_abc'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.updatedAt).toBe(fakeUpdatedAt.toISOString());
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'pa_abc' },
      data: expect.objectContaining({
        aiNarrative: '## 1. Bottom line\n\nWorth it.',
        narrativeUpdatedAt: expect.any(Date),
      }),
    });
  });
});
