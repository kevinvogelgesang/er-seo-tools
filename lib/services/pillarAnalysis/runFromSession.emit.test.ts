// lib/services/pillarAnalysis/runFromSession.emit.test.ts
//
// A5 Task 24: PillarAnalysisButtonClient (on the SF-upload session results
// page) subscribes to pillarAnalysisTopic(sessionId) — the SAME sessionId
// argument runPillarAnalysisForSession is always called with (the session
// path never needs a row lookup for the topic id). Emits after every
// pending/running/complete/error write on the SESSION path only — the
// sibling runForCanonical() live-scan path is keyed by crawlRunId (no
// session) and has no PillarAnalysisButtonClient subscriber, so it's
// deliberately untouched here.
//
// Heavy pipeline internals (CSV parsing, embeddings) are mocked out — this
// test is only about the emit seam, not the analysis pipeline itself (which
// has no dedicated unit test today; runForCanonical.test.ts covers the
// canonical/live-scan sibling end-to-end with a real DB).
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('@/lib/events/bus', () => ({ publishInvalidation: vi.fn() }));
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(async () => 'url\nhttps://example.test/a'),
    readdir: vi.fn(async () => [] as string[]),
    access: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
  },
}));
vi.mock('@/lib/parsers/internal.parser', () => ({
  InternalParser: class {
    parsePerUrlForPillar() {
      return [];
    }
  },
}));
vi.mock('@/lib/services/pillarAnalysis.service', () => ({
  runPillarAnalysisFromInputs: vi.fn(async () => ({
    score: 5,
    subscores: {},
    subscorePresence: {},
    subscoreContext: {},
    dataCompleteness: 1,
    hubRecommendation: {},
    pillarTopics: [],
    urlVerdicts: [],
  })),
}));

const { prisma } = await import('@/lib/db');
const { publishInvalidation } = await import('@/lib/events/bus');
const { pillarAnalysisTopic } = await import('@/lib/events/topics');
const { promises: fsPromises } = await import('fs');
const { runPillarAnalysisForSession, PillarAnalysisRunError } = await import('./runFromSession');

const PREFIX = 'rfs-emit-';

async function clearTestState() {
  await prisma.pillarAnalysis.deleteMany({ where: { session: { files: { contains: PREFIX } } } });
  await prisma.session.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

async function makeSession(): Promise<string> {
  const id = PREFIX + randomUUID().slice(0, 8);
  await prisma.session.create({
    data: { id, status: 'complete', files: JSON.stringify([`${PREFIX}internal_all.csv`]) },
  });
  return id;
}

describe('runPillarAnalysisForSession — pillarAnalysisTopic emit (A5 Task 24)', () => {
  beforeEach(async () => {
    vi.mocked(publishInvalidation).mockClear();
    vi.mocked(fsPromises.access).mockReset().mockResolvedValue(undefined);
    vi.mocked(fsPromises.readFile).mockReset().mockResolvedValue('url\nhttps://example.test/a');
    vi.mocked(fsPromises.readdir).mockReset().mockResolvedValue([]);
    vi.mocked(fsPromises.rm).mockReset().mockResolvedValue(undefined);
    await clearTestState();
  });
  afterAll(clearTestState);

  it('emits pillarAnalysisTopic(sessionId) on the create->running write and again on the complete write', async () => {
    const sessionId = await makeSession();

    const result = await runPillarAnalysisForSession(sessionId);

    expect(result.status).toBe('complete');
    const calls = vi.mocked(publishInvalidation).mock.calls.map((c) => c[0]);
    expect(calls).toEqual([pillarAnalysisTopic(sessionId), pillarAnalysisTopic(sessionId)]);
  });

  it('emits pillarAnalysisTopic(sessionId) on the error write when internal_all.csv is missing', async () => {
    const sessionId = await makeSession();
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'));

    await expect(runPillarAnalysisForSession(sessionId)).rejects.toThrow(PillarAnalysisRunError);

    const calls = vi.mocked(publishInvalidation).mock.calls.map((c) => c[0]);
    // One emit for the create->running write, one for the error write.
    expect(calls).toEqual([pillarAnalysisTopic(sessionId), pillarAnalysisTopic(sessionId)]);
  });

  it('does not emit when the row is already complete (idempotent return, no write)', async () => {
    const sessionId = await makeSession();
    await prisma.pillarAnalysis.create({ data: { sessionId, status: 'complete' } });

    const result = await runPillarAnalysisForSession(sessionId);

    expect(result.status).toBe('complete');
    expect(publishInvalidation).not.toHaveBeenCalled();
  });

  it('does not emit when a run is already in flight (409 throw, no write)', async () => {
    const sessionId = await makeSession();
    await prisma.pillarAnalysis.create({ data: { sessionId, status: 'running' } });

    await expect(runPillarAnalysisForSession(sessionId)).rejects.toMatchObject({ code: 'already_running' });

    expect(publishInvalidation).not.toHaveBeenCalled();
  });
});
