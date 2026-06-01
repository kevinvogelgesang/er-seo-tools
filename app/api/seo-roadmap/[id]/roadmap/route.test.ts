import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const findUniqueMock = vi.fn();
const updateMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    seoRoadmap: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

import { PATCH } from './route';
import { NextRequest } from 'next/server';
import { mintSeoRoadmapToken } from '@/lib/seo-roadmap-token';
import { SignJWT } from 'jose';

const ORIG_ENV = { ...process.env };

const ROADMAP_ID = 'srt_test_roadmap_id';

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
  return new NextRequest(`http://localhost:3000/api/seo-roadmap/${ROADMAP_ID}/roadmap`, init);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function authHeader(roadmapId: string) {
  const { token } = await mintSeoRoadmapToken(roadmapId);
  return { Authorization: `Bearer ${token}` };
}

describe('PATCH /api/seo-roadmap/[id]/roadmap', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    updateMock.mockReset();
    process.env = {
      ...ORIG_ENV,
      SEO_ROADMAP_TOKEN_SECRET: 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaa',
      NODE_ENV: 'test',
    };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  // ─── Body validation (happens before auth) ───────────────────────────────

  it('400 invalid_json on malformed body', async () => {
    const auth = await authHeader(ROADMAP_ID);
    const req = new NextRequest(
      `http://localhost:3000/api/seo-roadmap/${ROADMAP_ID}/roadmap`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: '{not json',
      },
    );
    const res = await PATCH(req, makeParams(ROADMAP_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
  });

  it('400 roadmap_required when field is missing', async () => {
    const auth = await authHeader(ROADMAP_ID);
    const res = await PATCH(makeRequest({ otherField: 'x' }, auth), makeParams(ROADMAP_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('roadmap_required');
  });

  it('400 roadmap_required when field is empty string', async () => {
    const auth = await authHeader(ROADMAP_ID);
    const res = await PATCH(makeRequest({ roadmap: '' }, auth), makeParams(ROADMAP_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('roadmap_required');
  });

  it('400 roadmap_too_long when over 50k chars', async () => {
    const auth = await authHeader(ROADMAP_ID);
    const big = 'x'.repeat(50_001);
    const res = await PATCH(makeRequest({ roadmap: big }, auth), makeParams(ROADMAP_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('roadmap_too_long');
  });

  it('400 structured_too_long when structured stringifies beyond 200k', async () => {
    const auth = await authHeader(ROADMAP_ID);
    // Build an object that when JSON.stringify'd exceeds 200k chars
    const bigObj = { data: 'x'.repeat(200_001) };
    const res = await PATCH(
      makeRequest({ roadmap: '# Roadmap', structured: bigObj }, auth),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('structured_too_long');
  });

  it('400 structured_invalid when structured is a non-object (e.g. a pre-stringified value)', async () => {
    const auth = await authHeader(ROADMAP_ID);
    const res = await PATCH(
      makeRequest({ roadmap: '# Roadmap', structured: 'already-a-string' }, auth),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('structured_invalid');
  });

  // ─── Auth: missing / malformed ───────────────────────────────────────────

  it('401 auth_missing when no Authorization header', async () => {
    const res = await PATCH(makeRequest({ roadmap: '# Roadmap' }), makeParams(ROADMAP_ID));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_missing');
  });

  it('401 auth_malformed when header is not "Bearer srt_..."', async () => {
    const res = await PATCH(
      makeRequest({ roadmap: '# Roadmap' }, { Authorization: 'Basic xyz' }),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_malformed');
  });

  it('401 auth_malformed when token lacks srt_ prefix', async () => {
    const res = await PATCH(
      makeRequest({ roadmap: '# Roadmap' }, { Authorization: 'Bearer not-an-srt-token' }),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_malformed');
  });

  // ─── Token verification errors ───────────────────────────────────────────

  it('401 token_invalid when a garbage srt_ token is presented', async () => {
    const res = await PATCH(
      makeRequest({ roadmap: '# Roadmap' }, { Authorization: 'Bearer srt_this.is.garbage' }),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('token_invalid');
  });

  it('401 token_wrong_roadmap_id when token is minted for a different roadmap id', async () => {
    const auth = await authHeader('srt_other_roadmap_id');
    const res = await PATCH(
      makeRequest({ roadmap: '# Roadmap' }, auth),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('token_wrong_roadmap_id');
  });

  // ─── Scope check ─────────────────────────────────────────────────────────

  it('401 token_missing_scope when JWT lacks roadmap-write scope', async () => {
    // Hand-mint a token with read-only scope (mintSeoRoadmapToken always includes roadmap-write)
    const secret = new TextEncoder().encode(process.env.SEO_ROADMAP_TOKEN_SECRET);
    const readOnlyJwt = await new SignJWT({ scope: ['read'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('er-seo-tools')
      .setAudience('seo-audit-roadmap')
      .setSubject(ROADMAP_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
    const res = await PATCH(
      makeRequest({ roadmap: '# Roadmap' }, { Authorization: `Bearer srt_${readOnlyJwt}` }),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('token_missing_scope');
  });

  // ─── DB look-up ──────────────────────────────────────────────────────────

  it('404 not_found when roadmap does not exist', async () => {
    findUniqueMock.mockResolvedValue(null);
    const auth = await authHeader(ROADMAP_ID);
    const res = await PATCH(makeRequest({ roadmap: '# Roadmap' }, auth), makeParams(ROADMAP_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
  });

  // ─── Happy path ──────────────────────────────────────────────────────────

  it('200 success writes roadmapMarkdown, status:complete, error:null, returns ok+updatedAt', async () => {
    const fakeUpdatedAt = new Date('2026-06-01T12:00:00Z');
    findUniqueMock.mockResolvedValue({ id: ROADMAP_ID });
    updateMock.mockResolvedValue({ id: ROADMAP_ID, roadmapUpdatedAt: fakeUpdatedAt });

    const auth = await authHeader(ROADMAP_ID);
    const res = await PATCH(
      makeRequest({ roadmap: '## Priority Actions\n\n1. Fix titles' }, auth),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.updatedAt).toBe(fakeUpdatedAt.toISOString());
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: ROADMAP_ID },
      data: expect.objectContaining({
        roadmapMarkdown: '## Priority Actions\n\n1. Fix titles',
        status: 'complete',
        error: null,
        roadmapUpdatedAt: expect.any(Date),
      }),
    });
    // structured should NOT be in data when not provided
    const callData = updateMock.mock.calls[0][0].data;
    expect(callData).not.toHaveProperty('structured');
  });

  it('200 with structured: persists the serialized JSON in the update call', async () => {
    const fakeUpdatedAt = new Date('2026-06-01T13:00:00Z');
    findUniqueMock.mockResolvedValue({ id: ROADMAP_ID });
    updateMock.mockResolvedValue({ id: ROADMAP_ID, roadmapUpdatedAt: fakeUpdatedAt });

    const structuredPayload = { priorities: [{ rank: 1, action: 'Fix page titles' }] };
    const auth = await authHeader(ROADMAP_ID);
    const res = await PATCH(
      makeRequest({ roadmap: '## Roadmap', structured: structuredPayload }, auth),
      makeParams(ROADMAP_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.updatedAt).toBe(fakeUpdatedAt.toISOString());
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: ROADMAP_ID },
      data: expect.objectContaining({
        roadmapMarkdown: '## Roadmap',
        structured: JSON.stringify(structuredPayload),
        status: 'complete',
        error: null,
        roadmapUpdatedAt: expect.any(Date),
      }),
    });
  });
});
