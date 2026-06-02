import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

// Mock prisma so we don't need a DB. We mock @/lib/db at the module-import level.
const sessionFindUniqueMock = vi.fn();
const seoRoadmapFindUniqueMock = vi.fn();
const seoRoadmapCreateMock = vi.fn();
const seoRoadmapUpdateMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    session: {
      findUnique: (...args: unknown[]) => sessionFindUniqueMock(...args),
    },
    seoRoadmap: {
      findUnique: (...args: unknown[]) => seoRoadmapFindUniqueMock(...args),
      create: (...args: unknown[]) => seoRoadmapCreateMock(...args),
      update: (...args: unknown[]) => seoRoadmapUpdateMock(...args),
    },
  },
}));

// Mock seo-roadmap-token so we control mint behaviour without env var tricks.
const mintSeoRoadmapTokenMock = vi.fn();
vi.mock('@/lib/seo-roadmap-token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/seo-roadmap-token')>();
  return {
    ...actual,
    mintSeoRoadmapToken: (...args: unknown[]) => mintSeoRoadmapTokenMock(...args),
  };
});

import { POST } from './route';
import { NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth';
import { SeoRoadmapTokenError } from '@/lib/seo-roadmap-token';

const ORIG_ENV = { ...process.env };

async function makeRequest(authenticated = true) {
  const headers = new Headers();
  if (authenticated) {
    headers.set('cookie', `${AUTH_COOKIE_NAME}=${await createAuthCookieValue()}`);
  }
  return new NextRequest('http://localhost:3000/api/seo-roadmap/by-session/sess_123/mint-token', {
    method: 'POST',
    headers,
  });
}

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

const COMPLETE_SESSION = { id: 'sess_123', status: 'complete' };
const ROADMAP_ROW = { id: 'rm_abc', sessionId: 'sess_123', status: 'pending' };
const MINTED_TOKEN = { token: 'srt_testtoken', expiresAt: new Date(Date.now() + 3600_000).toISOString() };

describe('POST /api/seo-roadmap/by-session/[sessionId]/mint-token', () => {
  beforeEach(() => {
    sessionFindUniqueMock.mockReset();
    seoRoadmapFindUniqueMock.mockReset();
    seoRoadmapCreateMock.mockReset();
    seoRoadmapUpdateMock.mockReset();
    mintSeoRoadmapTokenMock.mockReset();
    mintSeoRoadmapTokenMock.mockResolvedValue(MINTED_TOKEN);
    process.env = { ...ORIG_ENV };
    vi.stubEnv('APP_AUTH_PASSWORD', 'test-app-password');
    vi.stubEnv('NODE_ENV', 'test');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...ORIG_ENV };
  });

  it('401 when app auth cookie is missing', async () => {
    const res = await POST(await makeRequest(false), makeParams('sess_123'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('auth_required');
    expect(sessionFindUniqueMock).not.toHaveBeenCalled();
  });

  it('401 when app auth cookie is invalid', async () => {
    const headers = new Headers();
    headers.set('cookie', `${AUTH_COOKIE_NAME}=invalid-cookie-value`);
    const req = new NextRequest('http://localhost:3000/api/seo-roadmap/by-session/sess_123/mint-token', {
      method: 'POST',
      headers,
    });
    const res = await POST(req, makeParams('sess_123'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('auth_required');
  });

  it('404 when session not found', async () => {
    sessionFindUniqueMock.mockResolvedValue(null);
    const res = await POST(await makeRequest(), makeParams('sess_missing'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not_found');
  });

  it('409 when session is not complete', async () => {
    sessionFindUniqueMock.mockResolvedValue({ id: 'sess_123', status: 'running' });
    const res = await POST(await makeRequest(), makeParams('sess_123'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('session_not_complete');
    expect(body.status).toBe('running');
  });

  it('200 (no existing roadmap row — create path): returns token, expiresAt, roadmapId; flips to processing', async () => {
    sessionFindUniqueMock.mockResolvedValue(COMPLETE_SESSION);
    // first findUnique (no existing row), then create succeeds
    seoRoadmapFindUniqueMock.mockResolvedValue(null);
    seoRoadmapCreateMock.mockResolvedValue(ROADMAP_ROW);
    seoRoadmapUpdateMock.mockResolvedValue({ ...ROADMAP_ROW, status: 'processing' });

    const res = await POST(await makeRequest(), makeParams('sess_123'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('srt_testtoken');
    expect(typeof body.expiresAt).toBe('string');
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(body.roadmapId).toBe('rm_abc');

    // create was called once, update was called to set processing
    expect(seoRoadmapCreateMock).toHaveBeenCalledTimes(1);
    expect(seoRoadmapUpdateMock).toHaveBeenCalledTimes(1);
    const updateCall = seoRoadmapUpdateMock.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 'rm_abc' });
    expect(updateCall.data.status).toBe('processing');
    expect(updateCall.data.tokenMintedAt).toBeInstanceOf(Date);
    expect(updateCall.data.error).toBeNull();
  });

  it('200 (existing roadmap row — regenerate path): no create called, flips to processing', async () => {
    sessionFindUniqueMock.mockResolvedValue(COMPLETE_SESSION);
    // findUnique returns existing row — skip create
    seoRoadmapFindUniqueMock.mockResolvedValue(ROADMAP_ROW);
    seoRoadmapUpdateMock.mockResolvedValue({ ...ROADMAP_ROW, status: 'processing' });

    const res = await POST(await makeRequest(), makeParams('sess_123'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('srt_testtoken');
    expect(body.roadmapId).toBe('rm_abc');

    expect(seoRoadmapCreateMock).not.toHaveBeenCalled();
    expect(seoRoadmapUpdateMock).toHaveBeenCalledTimes(1);
    const updateCall = seoRoadmapUpdateMock.mock.calls[0][0];
    expect(updateCall.data.status).toBe('processing');
  });

  it('200 (unique-race path): create throws P2002, fallback findUnique returns row → 200', async () => {
    sessionFindUniqueMock.mockResolvedValue(COMPLETE_SESSION);
    seoRoadmapUpdateMock.mockResolvedValue({ ...ROADMAP_ROW, status: 'processing' });

    // First findUnique returns null (no existing row), create throws P2002 race, second findUnique returns row
    seoRoadmapFindUniqueMock
      .mockResolvedValueOnce(null)       // initial check — no row
      .mockResolvedValueOnce(ROADMAP_ROW); // fallback after P2002

    const p2002 = new Prisma.PrismaClientKnownRequestError('unique constraint failed', {
      code: 'P2002',
      clientVersion: 'x',
    });
    seoRoadmapCreateMock.mockRejectedValue(p2002);

    const res = await POST(await makeRequest(), makeParams('sess_123'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('srt_testtoken');
    expect(body.roadmapId).toBe('rm_abc');

    expect(seoRoadmapCreateMock).toHaveBeenCalledTimes(1);
    expect(seoRoadmapFindUniqueMock).toHaveBeenCalledTimes(2);
    expect(seoRoadmapUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('500 roadmap_unavailable when P2002 race + fallback findUnique returns null', async () => {
    sessionFindUniqueMock.mockResolvedValue(COMPLETE_SESSION);
    seoRoadmapFindUniqueMock.mockResolvedValue(null); // both calls return null
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique constraint failed', {
      code: 'P2002',
      clientVersion: 'x',
    });
    seoRoadmapCreateMock.mockRejectedValue(p2002);

    const res = await POST(await makeRequest(), makeParams('sess_123'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('roadmap_unavailable');
  });

  it('500 token_service_unavailable when mintSeoRoadmapToken throws SeoRoadmapTokenError', async () => {
    sessionFindUniqueMock.mockResolvedValue(COMPLETE_SESSION);
    seoRoadmapFindUniqueMock.mockResolvedValue(ROADMAP_ROW);
    seoRoadmapUpdateMock.mockResolvedValue({ ...ROADMAP_ROW, status: 'error' });

    mintSeoRoadmapTokenMock.mockRejectedValue(
      new SeoRoadmapTokenError('SEO_ROADMAP_TOKEN_SECRET is required in production and is unset.'),
    );

    const res = await POST(await makeRequest(), makeParams('sess_123'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('token_service_unavailable');

    // Should have called update to set status: 'error'
    expect(seoRoadmapUpdateMock).toHaveBeenCalledTimes(1);
    const updateCall = seoRoadmapUpdateMock.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 'rm_abc' });
    expect(updateCall.data.status).toBe('error');
    expect(updateCall.data.error).toBe('token_service_unavailable');
  });

  it('rethrows non-Prisma errors from seoRoadmap.create', async () => {
    sessionFindUniqueMock.mockResolvedValue(COMPLETE_SESSION);
    seoRoadmapFindUniqueMock.mockResolvedValue(null);
    seoRoadmapCreateMock.mockRejectedValue(new Error('unexpected db error'));

    await expect(POST(await makeRequest(), makeParams('sess_123'))).rejects.toThrow('unexpected db error');
  });
});
