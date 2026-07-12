// app/api/pillar-analysis/[id]/narrative/route.emit.test.ts
//
// A5 Task 24: MemoPoller (app/(app)/pillar-analysis/[id]/components/MemoPoller.tsx)
// polls by Session.id when present, else falls back to PillarAnalysis.id
// (analysisId) for live-scan/crawlRun-keyed analyses that have no session.
// The narrative PATCH route's `id` param is always PillarAnalysis.id, so the
// emit must mirror MemoPoller's own fallback: memo:<sessionId ?? id>.
// Deliberately does NOT emit pillarAnalysisTopic — PillarAnalysisButtonClient
// (the pillarAnalysisTopic subscriber) only tracks id/status/error and stops
// polling once status is 'complete' or 'error'; narrative writes always
// happen after the analysis is already complete, so that subscriber has
// nothing to react to here (documented decision, not an oversight).
// Separate file from route.test.ts (fully mocked prisma already).
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
vi.mock('@/lib/events/bus', () => ({ publishInvalidation: vi.fn() }));

import { PATCH } from './route';
import { NextRequest } from 'next/server';
import { mintPillarToken } from '@/lib/pillar-token';
import { publishInvalidation } from '@/lib/events/bus';
import { memoTopic, pillarAnalysisTopic } from '@/lib/events/topics';

const ORIG_ENV = { ...process.env };
const ANALYSIS_ID = 'pa_test_id';
const SESSION_ID = 'sess-pa-123';

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000/api/pillar-analysis/${ANALYSIS_ID}/narrative`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}
async function authHeader(analysisId: string) {
  const { token } = await mintPillarToken(analysisId);
  return { Authorization: `Bearer ${token}` };
}

describe('PATCH /api/pillar-analysis/[id]/narrative — SSE emit (A5 Task 24)', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    updateMock.mockReset();
    vi.mocked(publishInvalidation).mockClear();
    process.env = { ...ORIG_ENV, PILLAR_TOKEN_SECRET: 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaa', NODE_ENV: 'test' };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('emits memo:<sessionId> when the row has a session (SF-upload analysis)', async () => {
    findUniqueMock.mockResolvedValue({ id: ANALYSIS_ID, sessionId: SESSION_ID });
    updateMock.mockResolvedValue({ id: ANALYSIS_ID, sessionId: SESSION_ID, narrativeUpdatedAt: new Date('2026-07-12T00:00:00Z') });

    const auth = await authHeader(ANALYSIS_ID);
    const res = await PATCH(makeRequest({ narrative: 'Some narrative text' }, auth), makeParams(ANALYSIS_ID));

    expect(res.status).toBe(200);
    expect(publishInvalidation).toHaveBeenCalledWith(memoTopic(SESSION_ID));
    expect(publishInvalidation).not.toHaveBeenCalledWith(memoTopic(ANALYSIS_ID));
  });

  it('falls back to memo:<analysisId> when the row has no session (live-scan/crawlRun-keyed)', async () => {
    findUniqueMock.mockResolvedValue({ id: ANALYSIS_ID, sessionId: null });
    updateMock.mockResolvedValue({ id: ANALYSIS_ID, sessionId: null, narrativeUpdatedAt: new Date('2026-07-12T00:00:00Z') });

    const auth = await authHeader(ANALYSIS_ID);
    const res = await PATCH(makeRequest({ narrative: 'Some narrative text' }, auth), makeParams(ANALYSIS_ID));

    expect(res.status).toBe(200);
    expect(publishInvalidation).toHaveBeenCalledWith(memoTopic(ANALYSIS_ID));
  });

  it('never emits pillarAnalysisTopic — PillarAnalysisButtonClient already stopped polling by the time narrative is written', async () => {
    findUniqueMock.mockResolvedValue({ id: ANALYSIS_ID, sessionId: SESSION_ID });
    updateMock.mockResolvedValue({ id: ANALYSIS_ID, sessionId: SESSION_ID, narrativeUpdatedAt: new Date() });

    const auth = await authHeader(ANALYSIS_ID);
    await PATCH(makeRequest({ narrative: 'Some narrative text' }, auth), makeParams(ANALYSIS_ID));

    expect(publishInvalidation).not.toHaveBeenCalledWith(pillarAnalysisTopic(SESSION_ID));
  });

  it('does not emit when the analysis row is not found (404, no write)', async () => {
    findUniqueMock.mockResolvedValue(null);
    const auth = await authHeader(ANALYSIS_ID);
    const res = await PATCH(makeRequest({ narrative: 'x' }, auth), makeParams(ANALYSIS_ID));
    expect(res.status).toBe(404);
    expect(publishInvalidation).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
