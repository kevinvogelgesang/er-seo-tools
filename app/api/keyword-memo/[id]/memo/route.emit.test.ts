// app/api/keyword-memo/[id]/memo/route.emit.test.ts
//
// A5 Task 24: KeywordMemoCard subscribes to `memo:<Session.id>` — the PATCH
// route's `id` param is the KeywordResearchSession row's OWN id, a different
// value from `sessionId` (the FK to the parser Session the card polls by via
// /api/keyword-memo/by-session/[sessionId]). The emit must use
// `updated.sessionId`, not the route param. Separate file from
// route.test.ts (fully mocked prisma already) — same precedent as
// ada-audit.emit.test.ts.
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
vi.mock('@/lib/events/bus', () => ({ publishInvalidation: vi.fn() }));

import { PATCH } from './route';
import { NextRequest } from 'next/server';
import { mintKeywordMemoToken } from '@/lib/keyword-memo-token';
import { publishInvalidation } from '@/lib/events/bus';
import { memoTopic } from '@/lib/events/topics';

const ORIG_ENV = { ...process.env };
const MEMO_ID = 'krt_test_memo_id';
const SESSION_ID = 'sess-kw-123';

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000/api/keyword-memo/${MEMO_ID}/memo`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}
async function authHeader(memoId: string) {
  const { token } = await mintKeywordMemoToken(memoId);
  return { Authorization: `Bearer ${token}` };
}

describe('PATCH /api/keyword-memo/[id]/memo — SSE emit (A5 Task 24)', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    updateMock.mockReset();
    vi.mocked(publishInvalidation).mockClear();
    process.env = {
      ...ORIG_ENV,
      KEYWORD_MEMO_TOKEN_SECRET: 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaa',
      NODE_ENV: 'test',
    };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('emits memo:<sessionId> (the row\'s sessionId FK, not the route id) after a successful write', async () => {
    findUniqueMock.mockResolvedValue({ id: MEMO_ID });
    updateMock.mockResolvedValue({ id: MEMO_ID, sessionId: SESSION_ID, memoUpdatedAt: new Date('2026-07-12T00:00:00Z') });

    const auth = await authHeader(MEMO_ID);
    const res = await PATCH(makeRequest({ memo: '## Memo' }, auth), makeParams(MEMO_ID));

    expect(res.status).toBe(200);
    expect(publishInvalidation).toHaveBeenCalledWith(memoTopic(SESSION_ID));
    expect(publishInvalidation).not.toHaveBeenCalledWith(memoTopic(MEMO_ID));
  });

  it('does not emit when the session row is not found (404, no write)', async () => {
    findUniqueMock.mockResolvedValue(null);
    const auth = await authHeader(MEMO_ID);
    const res = await PATCH(makeRequest({ memo: '## Memo' }, auth), makeParams(MEMO_ID));
    expect(res.status).toBe(404);
    expect(publishInvalidation).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
