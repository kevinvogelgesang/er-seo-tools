import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

// Mock prisma so we don't need a DB. We mock @/lib/db at the module-import level.
const sessionFindUniqueMock = vi.fn();
const sessionFindFirstMock = vi.fn();
const kwFindUniqueMock = vi.fn();
const kwCreateMock = vi.fn();
const kwUpdateMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    session: {
      findUnique: (...args: unknown[]) => sessionFindUniqueMock(...args),
      findFirst: (...args: unknown[]) => sessionFindFirstMock(...args),
    },
    keywordResearchSession: {
      findUnique: (...args: unknown[]) => kwFindUniqueMock(...args),
      create: (...args: unknown[]) => kwCreateMock(...args),
      update: (...args: unknown[]) => kwUpdateMock(...args),
    },
  },
}));

// Mock keyword-memo-token so we control mint behaviour without env var tricks.
const mintKeywordMemoTokenMock = vi.fn();
vi.mock('@/lib/keyword-memo-token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/keyword-memo-token')>();
  return {
    ...actual,
    mintKeywordMemoToken: (...args: unknown[]) => mintKeywordMemoTokenMock(...args),
  };
});

import { POST } from './route';
import { NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth';
import { KeywordMemoTokenError } from '@/lib/keyword-memo-token';

const ORIG_ENV = { ...process.env };

async function makeRequest(authenticated = true) {
  const headers = new Headers();
  if (authenticated) {
    headers.set('cookie', `${AUTH_COOKIE_NAME}=${await createAuthCookieValue()}`);
  }
  return new NextRequest('http://localhost:3000/api/keyword-memo/by-session/sess_123/mint-token', {
    method: 'POST',
    headers,
  });
}

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

const COMPLETE_SESSION = { id: 'sess_123', status: 'complete', clientId: null };
const COMPLETE_SESSION_WITH_CLIENT = { id: 'sess_123', status: 'complete', clientId: 42 };
const KW_ROW = { id: 'kw_abc', sessionId: 'sess_123', status: 'pending', clientId: null, technicalSessionId: null };
const MINTED_TOKEN = { token: 'krt_testtoken', expiresAt: new Date(Date.now() + 3600_000).toISOString() };

describe('POST /api/keyword-memo/by-session/[sessionId]/mint-token', () => {
  beforeEach(() => {
    sessionFindUniqueMock.mockReset();
    sessionFindFirstMock.mockReset();
    kwFindUniqueMock.mockReset();
    kwCreateMock.mockReset();
    kwUpdateMock.mockReset();
    mintKeywordMemoTokenMock.mockReset();
    mintKeywordMemoTokenMock.mockResolvedValue(MINTED_TOKEN);
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
    const req = new NextRequest('http://localhost:3000/api/keyword-memo/by-session/sess_123/mint-token', {
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
    sessionFindUniqueMock.mockResolvedValue({ id: 'sess_123', status: 'running', clientId: null });
    const res = await POST(await makeRequest(), makeParams('sess_123'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('session_not_complete');
    expect(body.status).toBe('running');
  });

  it('200 (no existing row — create path): returns token, expiresAt, memoId; flips to processing; sets clientId', async () => {
    sessionFindUniqueMock.mockResolvedValue(COMPLETE_SESSION);
    kwFindUniqueMock.mockResolvedValue(null);
    kwCreateMock.mockResolvedValue(KW_ROW);
    kwUpdateMock.mockResolvedValue({ ...KW_ROW, status: 'processing' });

    const res = await POST(await makeRequest(), makeParams('sess_123'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('krt_testtoken');
    expect(typeof body.expiresAt).toBe('string');
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(body.memoId).toBe('kw_abc');

    // create was called once with clientId
    expect(kwCreateMock).toHaveBeenCalledTimes(1);
    const createCall = kwCreateMock.mock.calls[0][0];
    expect(createCall.data.sessionId).toBe('sess_123');
    expect(createCall.data.clientId).toBeNull();

    // update was called to set processing
    expect(kwUpdateMock).toHaveBeenCalledTimes(1);
    const updateCall = kwUpdateMock.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 'kw_abc' });
    expect(updateCall.data.status).toBe('processing');
    expect(updateCall.data.tokenMintedAt).toBeInstanceOf(Date);
    expect(updateCall.data.error).toBeNull();
  });

  it('200 (existing row — regenerate path): no create called, flips to processing', async () => {
    sessionFindUniqueMock.mockResolvedValue(COMPLETE_SESSION);
    kwFindUniqueMock.mockResolvedValue(KW_ROW);
    kwUpdateMock.mockResolvedValue({ ...KW_ROW, status: 'processing' });

    const res = await POST(await makeRequest(), makeParams('sess_123'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('krt_testtoken');
    expect(body.memoId).toBe('kw_abc');

    expect(kwCreateMock).not.toHaveBeenCalled();
    expect(kwUpdateMock).toHaveBeenCalledTimes(1);
    const updateCall = kwUpdateMock.mock.calls[0][0];
    expect(updateCall.data.status).toBe('processing');
  });

  it('200 (unique-race path): create throws P2002, fallback findUnique returns row → 200', async () => {
    sessionFindUniqueMock.mockResolvedValue(COMPLETE_SESSION);
    kwUpdateMock.mockResolvedValue({ ...KW_ROW, status: 'processing' });

    // First findUnique returns null (no existing row), create throws P2002 race, second findUnique returns row
    kwFindUniqueMock
      .mockResolvedValueOnce(null)       // initial check — no row
      .mockResolvedValueOnce(KW_ROW);    // fallback after P2002

    const p2002 = new Prisma.PrismaClientKnownRequestError('unique constraint failed', {
      code: 'P2002',
      clientVersion: 'x',
    });
    kwCreateMock.mockRejectedValue(p2002);

    const res = await POST(await makeRequest(), makeParams('sess_123'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('krt_testtoken');
    expect(body.memoId).toBe('kw_abc');

    expect(kwCreateMock).toHaveBeenCalledTimes(1);
    expect(kwFindUniqueMock).toHaveBeenCalledTimes(2);
    expect(kwUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('500 memo_unavailable when P2002 race + fallback findUnique returns null', async () => {
    sessionFindUniqueMock.mockResolvedValue(COMPLETE_SESSION);
    kwFindUniqueMock.mockResolvedValue(null); // both calls return null
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique constraint failed', {
      code: 'P2002',
      clientVersion: 'x',
    });
    kwCreateMock.mockRejectedValue(p2002);

    const res = await POST(await makeRequest(), makeParams('sess_123'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('memo_unavailable');
  });

  it('500 token_service_unavailable when mintKeywordMemoToken throws KeywordMemoTokenError', async () => {
    sessionFindUniqueMock.mockResolvedValue(COMPLETE_SESSION);
    kwFindUniqueMock.mockResolvedValue(KW_ROW);
    kwUpdateMock.mockResolvedValue({ ...KW_ROW, status: 'error' });

    mintKeywordMemoTokenMock.mockRejectedValue(
      new KeywordMemoTokenError('KEYWORD_MEMO_TOKEN_SECRET is required in production and is unset.'),
    );

    const res = await POST(await makeRequest(), makeParams('sess_123'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('token_service_unavailable');

    // Should have called update to set status: 'error'
    expect(kwUpdateMock).toHaveBeenCalledTimes(1);
    const updateCall = kwUpdateMock.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 'kw_abc' });
    expect(updateCall.data.status).toBe('error');
    expect(updateCall.data.error).toBe('token_service_unavailable');
  });

  it('rethrows non-Prisma errors from keywordResearchSession.create', async () => {
    sessionFindUniqueMock.mockResolvedValue(COMPLETE_SESSION);
    kwFindUniqueMock.mockResolvedValue(null);
    kwCreateMock.mockRejectedValue(new Error('unexpected db error'));

    await expect(POST(await makeRequest(), makeParams('sess_123'))).rejects.toThrow('unexpected db error');
  });

  it('sets technicalSessionId when a prior complete technical session exists for the same client', async () => {
    sessionFindUniqueMock.mockResolvedValue(COMPLETE_SESSION_WITH_CLIENT);
    kwFindUniqueMock.mockResolvedValue(null);
    // The prior technical session
    sessionFindFirstMock.mockResolvedValue({ id: 'tech_sess_prior', status: 'complete', workflow: 'technical' });
    const createdRow = { ...KW_ROW, clientId: 42, technicalSessionId: 'tech_sess_prior' };
    kwCreateMock.mockResolvedValue(createdRow);
    kwUpdateMock.mockResolvedValue({ ...createdRow, status: 'processing' });

    const res = await POST(await makeRequest(), makeParams('sess_123'));
    expect(res.status).toBe(200);

    // Verify create was called with technicalSessionId
    expect(kwCreateMock).toHaveBeenCalledTimes(1);
    const createCall = kwCreateMock.mock.calls[0][0];
    expect(createCall.data.technicalSessionId).toBe('tech_sess_prior');
    expect(createCall.data.clientId).toBe(42);

    // Verify findFirst was called with the correct filter
    expect(sessionFindFirstMock).toHaveBeenCalledTimes(1);
    const findFirstCall = sessionFindFirstMock.mock.calls[0][0];
    expect(findFirstCall.where.clientId).toBe(42);
    expect(findFirstCall.where.status).toBe('complete');
    expect(findFirstCall.where.workflow).toBe('technical');
    expect(findFirstCall.where.id).toEqual({ not: 'sess_123' });
    expect(findFirstCall.where.keywordResearch).toEqual({ is: null });
    expect(findFirstCall.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('technicalSessionId is null when no prior technical session exists for the client', async () => {
    sessionFindUniqueMock.mockResolvedValue(COMPLETE_SESSION_WITH_CLIENT);
    kwFindUniqueMock.mockResolvedValue(null);
    sessionFindFirstMock.mockResolvedValue(null); // no matching technical session
    const createdRow = { ...KW_ROW, clientId: 42, technicalSessionId: null };
    kwCreateMock.mockResolvedValue(createdRow);
    kwUpdateMock.mockResolvedValue({ ...createdRow, status: 'processing' });

    const res = await POST(await makeRequest(), makeParams('sess_123'));
    expect(res.status).toBe(200);

    expect(kwCreateMock).toHaveBeenCalledTimes(1);
    const createCall = kwCreateMock.mock.calls[0][0];
    expect(createCall.data.technicalSessionId).toBeNull();
  });

  it('does not call session.findFirst when clientId is null', async () => {
    sessionFindUniqueMock.mockResolvedValue(COMPLETE_SESSION); // clientId: null
    kwFindUniqueMock.mockResolvedValue(null);
    kwCreateMock.mockResolvedValue(KW_ROW);
    kwUpdateMock.mockResolvedValue({ ...KW_ROW, status: 'processing' });

    await POST(await makeRequest(), makeParams('sess_123'));

    expect(sessionFindFirstMock).not.toHaveBeenCalled();
    const createCall = kwCreateMock.mock.calls[0][0];
    expect(createCall.data.technicalSessionId).toBeNull();
  });
});
