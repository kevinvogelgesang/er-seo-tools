import { describe, it, expect, beforeEach, vi } from 'vitest';

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

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/pillar-analysis/by-analysis/pa_123');
}

function makeParams(analysisId: string) {
  return { params: Promise.resolve({ analysisId }) };
}

describe('GET /api/pillar-analysis/by-analysis/[analysisId]', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
  });

  it('returns null payload when analysis does not exist', async () => {
    findUniqueMock.mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams('pa_missing'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pillarAnalysis).toBeNull();
  });

  it('returns the analysis snapshot for a live-scan (no session) analysis', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'pa_live_1',
      sessionId: null,
      crawlRunId: 'run_abc',
      status: 'complete',
      error: null,
      score: 7,
      dataCompleteness: 0.4,
      hubRecommendation: '{"primary":"hybrid","alternates":[],"reasoning":[]}',
      createdAt: new Date('2026-06-30T10:00:00Z'),
      updatedAt: new Date('2026-06-30T10:05:00Z'),
      aiNarrative: null,
      narrativeUpdatedAt: null,
    });
    const res = await GET(makeRequest(), makeParams('pa_live_1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pillarAnalysis).not.toBeNull();
    expect(body.pillarAnalysis.id).toBe('pa_live_1');
    expect(body.pillarAnalysis.sessionId).toBeNull();
    expect(body.pillarAnalysis.crawlRunId).toBe('run_abc');
    expect(body.pillarAnalysis.aiNarrative).toBeNull();
    expect(body.pillarAnalysis.narrativeUpdatedAt).toBeNull();
    expect(body.pillarAnalysis.hubRecommendation).toEqual({
      primary: 'hybrid',
      alternates: [],
      reasoning: [],
    });
  });

  it('includes aiNarrative and narrativeUpdatedAt when present', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'pa_live_2',
      sessionId: null,
      crawlRunId: 'run_xyz',
      status: 'complete',
      error: null,
      score: 8,
      dataCompleteness: 0.6,
      hubRecommendation: null,
      createdAt: new Date('2026-06-30T10:00:00Z'),
      updatedAt: new Date('2026-06-30T11:00:00Z'),
      aiNarrative: '## Strategic Memo\n\nContent here.',
      narrativeUpdatedAt: new Date('2026-06-30T11:00:00Z'),
    });
    const res = await GET(makeRequest(), makeParams('pa_live_2'));
    const body = await res.json();
    expect(body.pillarAnalysis.aiNarrative).toBe('## Strategic Memo\n\nContent here.');
    expect(body.pillarAnalysis.narrativeUpdatedAt).toBe('2026-06-30T11:00:00.000Z');
  });

  it('works for a session-keyed analysis too (sessionId present)', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'pa_sess_1',
      sessionId: 'sess_abc',
      crawlRunId: null,
      status: 'complete',
      error: null,
      score: 9,
      dataCompleteness: 0.9,
      hubRecommendation: null,
      createdAt: new Date('2026-06-30T10:00:00Z'),
      updatedAt: new Date('2026-06-30T10:00:00Z'),
      aiNarrative: null,
      narrativeUpdatedAt: null,
    });
    const res = await GET(makeRequest(), makeParams('pa_sess_1'));
    const body = await res.json();
    expect(body.pillarAnalysis.sessionId).toBe('sess_abc');
    expect(body.pillarAnalysis.crawlRunId).toBeNull();
  });
});
