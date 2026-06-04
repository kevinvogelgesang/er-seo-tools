import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sessionFindUniqueMock = vi.fn();
const sessionUpdateManyMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    session: {
      findUnique: (...a: unknown[]) => sessionFindUniqueMock(...a),
      updateMany: (...a: unknown[]) => sessionUpdateManyMock(...a),
    },
  },
}));

// Keep the heavy parse pipeline + pillar trigger out of the gate test.
// NOTE: route.ts imports the trigger from '../pillar-analysis-trigger' (parent
// dir), so the mock path MUST match exactly or it won't intercept.
vi.mock('@/lib/services/aggregator.service', () => ({ AggregatorService: class {} }));
vi.mock('../pillar-analysis-trigger', () => ({ triggerPillarAnalysis: vi.fn() }));

import { POST } from './route';

const VALID_ID = '64c1a005-40e9-40d8-a62c-e4226cc78c0b';
const ctx = { params: Promise.resolve({ sessionId: VALID_ID }) };

describe('POST /api/parse/[sessionId] — core-export gate', () => {
  beforeEach(() => {
    sessionFindUniqueMock.mockReset();
    sessionUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.restoreAllMocks());

  it('rejects a technical session missing core exports without claiming it', async () => {
    sessionFindUniqueMock.mockResolvedValue({
      id: VALID_ID,
      status: 'pending',
      workflow: 'technical',
      files: JSON.stringify(['images_missing_alt_text.csv']),
    });

    const res = await POST({} as never, ctx as never);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.toLowerCase()).toContain('internal');
    expect(body.missingCore).toContain('internal_all');
    expect(sessionUpdateManyMock).not.toHaveBeenCalled(); // not claimed
  });

  it('does NOT reject a keyword-research session on the core gate; it claims and proceeds', async () => {
    sessionFindUniqueMock.mockResolvedValue({
      id: VALID_ID,
      status: 'pending',
      workflow: 'keyword-research',
      files: JSON.stringify(['semrush_organic_positions.csv']),
    });

    let body: { missingCore?: unknown } = {};
    const res = await POST({} as never, ctx as never);
    try { body = await res.json(); } catch { /* downstream may not return JSON */ }

    expect(body.missingCore).toBeUndefined(); // not the core-gate rejection
    expect(sessionUpdateManyMock).toHaveBeenCalled(); // got past the gate to the claim
  });
});
