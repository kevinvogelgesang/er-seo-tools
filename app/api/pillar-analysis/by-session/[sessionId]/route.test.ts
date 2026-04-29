import { describe, it, expect, beforeEach, vi } from 'vitest';

const findFirstMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    pillarAnalysis: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
  },
}));

import { GET } from './route';
import { NextRequest } from 'next/server';

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/pillar-analysis/by-session/sess_x');
}

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

describe('GET /api/pillar-analysis/by-session/[sessionId]', () => {
  beforeEach(() => {
    findFirstMock.mockReset();
  });

  it('returns null payload when no analysis exists', async () => {
    findFirstMock.mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams('sess_missing'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pillarAnalysis).toBeNull();
  });

  it('includes aiNarrative and narrativeUpdatedAt in the response (both null)', async () => {
    findFirstMock.mockResolvedValue({
      id: 'pa_1',
      sessionId: 'sess_x',
      status: 'complete',
      error: null,
      score: 8,
      dataCompleteness: 0.9,
      hubRecommendation: null,
      createdAt: new Date('2026-04-29T10:00:00Z'),
      updatedAt: new Date('2026-04-29T10:05:00Z'),
      aiNarrative: null,
      narrativeUpdatedAt: null,
    });
    const res = await GET(makeRequest(), makeParams('sess_x'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pillarAnalysis.aiNarrative).toBeNull();
    expect(body.pillarAnalysis.narrativeUpdatedAt).toBeNull();
  });

  it('includes aiNarrative and narrativeUpdatedAt when present', async () => {
    findFirstMock.mockResolvedValue({
      id: 'pa_2',
      sessionId: 'sess_y',
      status: 'complete',
      error: null,
      score: 8,
      dataCompleteness: 0.9,
      hubRecommendation: null,
      createdAt: new Date('2026-04-29T10:00:00Z'),
      updatedAt: new Date('2026-04-29T11:00:00Z'),
      aiNarrative: '## 1. Bottom line\n\nWorth it.\n',
      narrativeUpdatedAt: new Date('2026-04-29T11:00:00Z'),
    });
    const res = await GET(makeRequest(), makeParams('sess_y'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pillarAnalysis.aiNarrative).toBe('## 1. Bottom line\n\nWorth it.\n');
    expect(body.pillarAnalysis.narrativeUpdatedAt).toBe('2026-04-29T11:00:00.000Z');
  });

  it('parses hubRecommendation JSON when present', async () => {
    findFirstMock.mockResolvedValue({
      id: 'pa_3',
      sessionId: 'sess_z',
      status: 'complete',
      error: null,
      score: 8,
      dataCompleteness: 0.9,
      hubRecommendation: '{"primary":"nest-under-programs","reasoning":[],"alternates":[]}',
      createdAt: new Date('2026-04-29T10:00:00Z'),
      updatedAt: new Date('2026-04-29T10:05:00Z'),
      aiNarrative: null,
      narrativeUpdatedAt: null,
    });
    const res = await GET(makeRequest(), makeParams('sess_z'));
    const body = await res.json();
    expect(body.pillarAnalysis.hubRecommendation).toEqual({
      primary: 'nest-under-programs',
      reasoning: [],
      alternates: [],
    });
  });
});
