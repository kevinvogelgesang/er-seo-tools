import { describe, it, expect, beforeEach, vi } from 'vitest';

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

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/keyword-memo/by-session/sess_x');
}

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

describe('GET /api/keyword-memo/by-session/[sessionId]', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
  });

  it('returns null payload when no keywordResearch row exists', async () => {
    findUniqueMock.mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams('sess_missing'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keywordResearch).toBeNull();
  });

  it('returns shaped object with status and memoMarkdown when row exists', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'kw_1',
      sessionId: 'sess_x',
      status: 'complete',
      error: null,
      memoMarkdown: '## Keyword Strategy\n\nFocus on long-tail.\n',
      memoUpdatedAt: new Date('2026-06-01T10:05:00Z'),
      createdAt: new Date('2026-06-01T10:00:00Z'),
      updatedAt: new Date('2026-06-01T10:05:00Z'),
    });
    const res = await GET(makeRequest(), makeParams('sess_x'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keywordResearch.id).toBe('kw_1');
    expect(body.keywordResearch.sessionId).toBe('sess_x');
    expect(body.keywordResearch.status).toBe('complete');
    expect(body.keywordResearch.error).toBeNull();
    expect(body.keywordResearch.memoMarkdown).toBe('## Keyword Strategy\n\nFocus on long-tail.\n');
    expect(body.keywordResearch.memoUpdatedAt).toBe('2026-06-01T10:05:00.000Z');
    expect(body.keywordResearch.createdAt).toBe('2026-06-01T10:00:00.000Z');
    expect(body.keywordResearch.updatedAt).toBe('2026-06-01T10:05:00.000Z');
  });

  it('returns null memoMarkdown and memoUpdatedAt when row is pending', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'kw_2',
      sessionId: 'sess_y',
      status: 'pending',
      error: null,
      memoMarkdown: null,
      memoUpdatedAt: null,
      createdAt: new Date('2026-06-01T09:00:00Z'),
      updatedAt: new Date('2026-06-01T09:00:00Z'),
    });
    const res = await GET(makeRequest(), makeParams('sess_y'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keywordResearch.status).toBe('pending');
    expect(body.keywordResearch.memoMarkdown).toBeNull();
    expect(body.keywordResearch.memoUpdatedAt).toBeNull();
  });
});
