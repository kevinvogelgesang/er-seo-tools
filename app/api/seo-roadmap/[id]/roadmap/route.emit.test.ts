// app/api/seo-roadmap/[id]/roadmap/route.emit.test.ts
//
// A5 Task 24: the SeoRoadmapCard subscribes to `memo:<Session.id>` — but the
// PATCH route's `id` param is the SeoRoadmap row's OWN id, a different value
// from `sessionId` (the FK to the parser Session the card actually polls by).
// The emit must use `updated.sessionId`, not the route param, or the card
// never gets pushed (topic mismatch is silent). Separate file from
// route.test.ts (which fully mocks prisma already) so the emit assertions
// don't disturb that large existing suite — same precedent as
// ada-audit.emit.test.ts / broken-link-verify.emit.test.ts.
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
vi.mock('@/lib/events/bus', () => ({ publishInvalidation: vi.fn() }));

import { PATCH } from './route';
import { NextRequest } from 'next/server';
import { mintSeoRoadmapToken } from '@/lib/seo-roadmap-token';
import { publishInvalidation } from '@/lib/events/bus';
import { memoTopic } from '@/lib/events/topics';

const ORIG_ENV = { ...process.env };
const ROADMAP_ID = 'srt_test_roadmap_id';
const SESSION_ID = 'sess-abc-123';

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000/api/seo-roadmap/${ROADMAP_ID}/roadmap`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}
async function authHeader(roadmapId: string) {
  const { token } = await mintSeoRoadmapToken(roadmapId);
  return { Authorization: `Bearer ${token}` };
}

describe('PATCH /api/seo-roadmap/[id]/roadmap — SSE emit (A5 Task 24)', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    updateMock.mockReset();
    vi.mocked(publishInvalidation).mockClear();
    process.env = {
      ...ORIG_ENV,
      SEO_ROADMAP_TOKEN_SECRET: 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaa',
      NODE_ENV: 'test',
    };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('emits memo:<sessionId> (the row\'s sessionId FK, not the route id) after a successful write', async () => {
    findUniqueMock.mockResolvedValue({ id: ROADMAP_ID });
    updateMock.mockResolvedValue({ id: ROADMAP_ID, sessionId: SESSION_ID, roadmapUpdatedAt: new Date('2026-07-12T00:00:00Z') });

    const auth = await authHeader(ROADMAP_ID);
    const res = await PATCH(makeRequest({ roadmap: '## Roadmap' }, auth), makeParams(ROADMAP_ID));

    expect(res.status).toBe(200);
    expect(publishInvalidation).toHaveBeenCalledWith(memoTopic(SESSION_ID));
    // Must NOT have emitted using the route's own id (a different value).
    expect(publishInvalidation).not.toHaveBeenCalledWith(memoTopic(ROADMAP_ID));
  });

  it('does not emit when the roadmap row is not found (404, no write)', async () => {
    findUniqueMock.mockResolvedValue(null);
    const auth = await authHeader(ROADMAP_ID);
    const res = await PATCH(makeRequest({ roadmap: '## Roadmap' }, auth), makeParams(ROADMAP_ID));
    expect(res.status).toBe(404);
    expect(publishInvalidation).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('does not emit on a body-validation 400 (before any DB write)', async () => {
    const auth = await authHeader(ROADMAP_ID);
    const res = await PATCH(makeRequest({ roadmap: '' }, auth), makeParams(ROADMAP_ID));
    expect(res.status).toBe(400);
    expect(publishInvalidation).not.toHaveBeenCalled();
  });
});
