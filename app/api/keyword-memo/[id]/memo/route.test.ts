import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const findUniqueMock = vi.fn();
const updateMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    keywordResearchSession: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

import { PATCH } from './route';
import { NextRequest } from 'next/server';
import { mintKeywordMemoToken } from '@/lib/keyword-memo-token';
import { SignJWT } from 'jose';

const ORIG_ENV = { ...process.env };

const MEMO_ID = 'krt_test_memo_id';

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
  return new NextRequest(`http://localhost:3000/api/keyword-memo/${MEMO_ID}/memo`, init);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function authHeader(memoId: string) {
  const { token } = await mintKeywordMemoToken(memoId);
  return { Authorization: `Bearer ${token}` };
}

describe('PATCH /api/keyword-memo/[id]/memo', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    updateMock.mockReset();
    process.env = {
      ...ORIG_ENV,
      KEYWORD_MEMO_TOKEN_SECRET: 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaa',
      NODE_ENV: 'test',
    };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  // ─── Body validation (happens before auth) ───────────────────────────────

  it('400 invalid_json on malformed body', async () => {
    const auth = await authHeader(MEMO_ID);
    const req = new NextRequest(
      `http://localhost:3000/api/keyword-memo/${MEMO_ID}/memo`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: '{not json',
      },
    );
    const res = await PATCH(req, makeParams(MEMO_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
  });

  it('400 memo_required when field is missing', async () => {
    const auth = await authHeader(MEMO_ID);
    const res = await PATCH(makeRequest({ otherField: 'x' }, auth), makeParams(MEMO_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('memo_required');
  });

  it('400 memo_required when field is empty string', async () => {
    const auth = await authHeader(MEMO_ID);
    const res = await PATCH(makeRequest({ memo: '' }, auth), makeParams(MEMO_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('memo_required');
  });

  it('400 memo_too_long when over 50k chars', async () => {
    const auth = await authHeader(MEMO_ID);
    const big = 'x'.repeat(50_001);
    const res = await PATCH(makeRequest({ memo: big }, auth), makeParams(MEMO_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('memo_too_long');
  });

  it('400 structured_too_long when structured stringifies beyond 200k', async () => {
    const auth = await authHeader(MEMO_ID);
    // Build an object that when JSON.stringify'd exceeds 200k chars
    const bigObj = { data: 'x'.repeat(200_001) };
    const res = await PATCH(
      makeRequest({ memo: '# Memo', structured: bigObj }, auth),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('structured_too_long');
  });

  it('400 structured_invalid when structured is a non-object (e.g. a pre-stringified value)', async () => {
    const auth = await authHeader(MEMO_ID);
    const res = await PATCH(
      makeRequest({ memo: '# Memo', structured: 'already-a-string' }, auth),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('structured_invalid');
  });

  // ─── Auth: missing / malformed ───────────────────────────────────────────

  it('401 auth_missing when no Authorization header', async () => {
    const res = await PATCH(makeRequest({ memo: '# Memo' }), makeParams(MEMO_ID));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_missing');
  });

  it('401 auth_malformed when header is not "Bearer krt_..."', async () => {
    const res = await PATCH(
      makeRequest({ memo: '# Memo' }, { Authorization: 'Basic xyz' }),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_malformed');
  });

  it('401 auth_malformed when token lacks krt_ prefix', async () => {
    const res = await PATCH(
      makeRequest({ memo: '# Memo' }, { Authorization: 'Bearer not-a-krt-token' }),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_malformed');
  });

  // ─── Token verification errors ───────────────────────────────────────────

  it('401 token_invalid when a garbage krt_ token is presented', async () => {
    const res = await PATCH(
      makeRequest({ memo: '# Memo' }, { Authorization: 'Bearer krt_this.is.garbage' }),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('token_invalid');
  });

  it('401 token_wrong_memo_id when token is minted for a different memo id', async () => {
    const auth = await authHeader('krt_other_memo_id');
    const res = await PATCH(
      makeRequest({ memo: '# Memo' }, auth),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('token_wrong_memo_id');
  });

  // ─── Scope check ─────────────────────────────────────────────────────────

  it('401 token_missing_scope when JWT lacks memo-write scope', async () => {
    // Hand-mint a token with read-only scope (mintKeywordMemoToken always includes memo-write)
    const secret = new TextEncoder().encode(process.env.KEYWORD_MEMO_TOKEN_SECRET);
    const readOnlyJwt = await new SignJWT({ scope: ['read'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('er-seo-tools')
      .setAudience('keyword-strategy-memo')
      .setSubject(MEMO_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
    const res = await PATCH(
      makeRequest({ memo: '# Memo' }, { Authorization: `Bearer krt_${readOnlyJwt}` }),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('token_missing_scope');
  });

  // ─── DB look-up ──────────────────────────────────────────────────────────

  it('404 not_found when session does not exist', async () => {
    findUniqueMock.mockResolvedValue(null);
    const auth = await authHeader(MEMO_ID);
    const res = await PATCH(makeRequest({ memo: '# Memo' }, auth), makeParams(MEMO_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
  });

  // ─── Happy path ──────────────────────────────────────────────────────────

  it('200 success writes memoMarkdown, status:complete, error:null, returns ok+updatedAt', async () => {
    const fakeUpdatedAt = new Date('2026-06-01T12:00:00Z');
    findUniqueMock.mockResolvedValue({ id: MEMO_ID });
    updateMock.mockResolvedValue({ id: MEMO_ID, memoUpdatedAt: fakeUpdatedAt });

    const auth = await authHeader(MEMO_ID);
    const res = await PATCH(
      makeRequest({ memo: '## Keyword Strategy\n\n1. Target gap keywords' }, auth),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.updatedAt).toBe(fakeUpdatedAt.toISOString());
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: MEMO_ID },
      data: expect.objectContaining({
        memoMarkdown: '## Keyword Strategy\n\n1. Target gap keywords',
        status: 'complete',
        error: null,
        memoUpdatedAt: expect.any(Date),
      }),
    });
    // structured should NOT be in data when not provided
    const callData = updateMock.mock.calls[0][0].data;
    expect(callData).not.toHaveProperty('structured');
  });

  it('200 with structured: persists the serialized JSON in the update call', async () => {
    const fakeUpdatedAt = new Date('2026-06-01T13:00:00Z');
    findUniqueMock.mockResolvedValue({ id: MEMO_ID });
    updateMock.mockResolvedValue({ id: MEMO_ID, memoUpdatedAt: fakeUpdatedAt });

    const structuredPayload = { priorities: [{ rank: 1, keyword: 'online nursing programs' }] };
    const auth = await authHeader(MEMO_ID);
    const res = await PATCH(
      makeRequest({ memo: '## Keyword Strategy', structured: structuredPayload }, auth),
      makeParams(MEMO_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.updatedAt).toBe(fakeUpdatedAt.toISOString());
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: MEMO_ID },
      data: expect.objectContaining({
        memoMarkdown: '## Keyword Strategy',
        structured: JSON.stringify(structuredPayload),
        status: 'complete',
        error: null,
        memoUpdatedAt: expect.any(Date),
      }),
    });
  });
});
