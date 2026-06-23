import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── hoist mocks so vi.mock factories can reference them ─────────────────────
const { mockQuery, mockGetAuthClient } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetAuthClient: vi.fn(),
}));

// ─── mock 'googleapis' before any import that uses it ──────────────────────
vi.mock('googleapis', () => {
  const searchconsoleFn = vi.fn().mockReturnValue({
    searchanalytics: { query: mockQuery },
  });
  return {
    google: {
      searchconsole: searchconsoleFn,
      auth: {
        GoogleAuth: vi.fn(),
      },
    },
  };
});

// ─── mock auth.ts ────────────────────────────────────────────────────────────
vi.mock('./auth', () => ({
  getAuthClient: mockGetAuthClient,
}));

import { fetchGsc } from './gsc-provider';
import type { DateWindow } from '../dates';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeWindow(start: string, end: string): DateWindow {
  return { start: new Date(start), end: new Date(end) };
}

const period = makeWindow('2026-05-01', '2026-05-31');
const comparison = makeWindow('2026-04-01', '2026-04-30');

const MOCK_AUTH = { ok: true as const, auth: {} as never };

/** GSC API response for a totals query (no dimensions) */
function makeTotalsResponse(overrides?: {
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}) {
  const v = {
    clicks: 1200,
    impressions: 45000,
    ctr: 0.0267,
    position: 14.5,
    ...overrides,
  };
  return {
    data: {
      rows: [
        {
          clicks: v.clicks,
          impressions: v.impressions,
          ctr: v.ctr,
          position: v.position,
        },
      ],
    },
  };
}

/** GSC API response for a date-dimension query */
function makeDateSeriesResponse(rows: Array<{ keys: string[]; clicks: number; impressions: number; position: number }>) {
  return {
    data: {
      rows: rows.map(r => ({
        keys: r.keys,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.clicks / r.impressions,
        position: r.position,
      })),
    },
  };
}

/** GSC API response for a query-dimension query */
function makeQueryDimensionResponse(rows: Array<{ keys: string[]; position: number }>) {
  return {
    data: {
      rows: rows.map(r => ({
        keys: r.keys,
        clicks: 100,
        impressions: 1000,
        ctr: 0.1,
        position: r.position,
      })),
    },
  };
}

/**
 * Set up a full happy-path mock sequence.
 * 3 queries × 2 windows = 6 calls in this order:
 *   period:     totals(0), dateSeries(1), queryDimension(2)
 *   comparison: totals(3), dateSeries(4), queryDimension(5)
 */
function setupHappyPath() {
  const periodTotals = makeTotalsResponse();
  const compTotals = makeTotalsResponse({
    clicks: 900,
    impressions: 38000,
    ctr: 0.0237,
    position: 16.2,
  });
  const periodDateSeries = makeDateSeriesResponse([
    { keys: ['2026-05-01'], clicks: 38, impressions: 1400, position: 14.0 },
    { keys: ['2026-05-02'], clicks: 42, impressions: 1500, position: 13.8 },
  ]);
  const compDateSeries = makeDateSeriesResponse([
    { keys: ['2026-04-01'], clicks: 30, impressions: 1200, position: 15.5 },
  ]);
  const periodQueryRows = makeQueryDimensionResponse([
    { keys: ['best practices seo'], position: 5.2 },
    { keys: ['seo audit tool'], position: 8.7 },
    { keys: ['only in period'], position: 12.0 },
  ]);
  const compQueryRows = makeQueryDimensionResponse([
    { keys: ['best practices seo'], position: 6.1 },
    { keys: ['seo audit tool'], position: 9.3 },
    // 'only in period' is absent from comparison
  ]);

  mockQuery
    .mockResolvedValueOnce(periodTotals)       // 0 — period totals
    .mockResolvedValueOnce(periodDateSeries)   // 1 — period date series
    .mockResolvedValueOnce(periodQueryRows)    // 2 — period query dimension
    .mockResolvedValueOnce(compTotals)         // 3 — comparison totals
    .mockResolvedValueOnce(compDateSeries)     // 4 — comparison date series
    .mockResolvedValueOnce(compQueryRows);     // 5 — comparison query dimension
}

// ─── tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthClient.mockResolvedValue(MOCK_AUTH);
});

// ── null siteUrl ──────────────────────────────────────────────────────────────

describe('null siteUrl', () => {
  it('returns {ok:false, reason:"unmapped"} immediately and never calls query', async () => {
    const result = await fetchGsc(null, period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unmapped');
    }
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockGetAuthClient).not.toHaveBeenCalled();
  });
});

// ── auth propagation ──────────────────────────────────────────────────────────

describe('auth propagation', () => {
  it('propagates {ok:false, reason:"auth"} when getAuthClient fails', async () => {
    mockGetAuthClient.mockResolvedValue({
      ok: false,
      reason: 'auth',
      message: 'key file missing',
    });

    const result = await fetchGsc('sc-domain:example.com', period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('auth');
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ── siteUrl verbatim ──────────────────────────────────────────────────────────

describe('siteUrl verbatim', () => {
  it('passes sc-domain:example.com unchanged to every searchanalytics.query call', async () => {
    setupHappyPath();
    const siteUrl = 'sc-domain:example.com';

    await fetchGsc(siteUrl, period, comparison);

    for (const call of mockQuery.mock.calls) {
      expect(call[0].siteUrl).toBe('sc-domain:example.com');
    }
  });

  it('passes https://example.com/ verbatim (no stripping of trailing slash)', async () => {
    // Setup minimal mocks for 6 calls
    const empty = { data: { rows: [] } };
    mockQuery.mockResolvedValue(empty);

    const siteUrl = 'https://example.com/';
    await fetchGsc(siteUrl, period, comparison);

    for (const call of mockQuery.mock.calls) {
      expect(call[0].siteUrl).toBe('https://example.com/');
    }
  });
});

// ── happy path ────────────────────────────────────────────────────────────────

describe('happy path', () => {
  it('returns ok:true with a correctly mapped GscBundle', async () => {
    setupHappyPath();

    const result = await fetchGsc('sc-domain:example.com', period, comparison);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const bundle = result.data;

    // totals — period
    expect(bundle.totals.clicks).toBe(1200);
    expect(bundle.totals.impressions).toBe(45000);
    expect(bundle.totals.ctr).toBeCloseTo(0.0267);
    expect(bundle.totals.position).toBeCloseTo(14.5);

    // comparisonTotals
    expect(bundle.comparisonTotals.clicks).toBe(900);
    expect(bundle.comparisonTotals.impressions).toBe(38000);
    expect(bundle.comparisonTotals.ctr).toBeCloseTo(0.0237);
    expect(bundle.comparisonTotals.position).toBeCloseTo(16.2);

    // clicksSeries — period
    expect(bundle.clicksSeries).toHaveLength(2);
    expect(bundle.clicksSeries[0]).toEqual({ date: '2026-05-01', value: 38 });
    expect(bundle.clicksSeries[1]).toEqual({ date: '2026-05-02', value: 42 });

    // clicksSeriesPrev — comparison
    expect(bundle.clicksSeriesPrev).toHaveLength(1);
    expect(bundle.clicksSeriesPrev[0]).toEqual({ date: '2026-04-01', value: 30 });

    // impressionsSeries — period
    expect(bundle.impressionsSeries).toHaveLength(2);
    expect(bundle.impressionsSeries[0]).toEqual({ date: '2026-05-01', value: 1400 });

    // impressionsSeriesPrev — comparison
    expect(bundle.impressionsSeriesPrev).toHaveLength(1);
    expect(bundle.impressionsSeriesPrev[0]).toEqual({ date: '2026-04-01', value: 1200 });

    // positionSeries — period
    expect(bundle.positionSeries).toHaveLength(2);
    expect(bundle.positionSeries[0]).toEqual({ date: '2026-05-01', value: 14.0 });

    // positionSeriesPrev — comparison
    expect(bundle.positionSeriesPrev).toHaveLength(1);
    expect(bundle.positionSeriesPrev[0]).toEqual({ date: '2026-04-01', value: 15.5 });
  });

  it('issues 6 searchanalytics.query calls total (3 queries × 2 windows)', async () => {
    setupHappyPath();

    await fetchGsc('sc-domain:example.com', period, comparison);

    expect(mockQuery).toHaveBeenCalledTimes(6);
  });

  it('uses period dates for calls 0-2 and comparison dates for calls 3-5', async () => {
    setupHappyPath();

    await fetchGsc('sc-domain:example.com', period, comparison);

    const calls = mockQuery.mock.calls;

    // call 0 — period totals
    const call0Body = calls[0][0].requestBody;
    expect(call0Body.startDate).toBe('2026-05-01');
    expect(call0Body.endDate).toBe('2026-05-31');

    // call 3 — comparison totals
    const call3Body = calls[3][0].requestBody;
    expect(call3Body.startDate).toBe('2026-04-01');
    expect(call3Body.endDate).toBe('2026-04-30');
  });

  it('totals query has no dimensions; date query has dimensions:["date"]; query query has dimensions:["query"]', async () => {
    setupHappyPath();

    await fetchGsc('sc-domain:example.com', period, comparison);

    const calls = mockQuery.mock.calls;

    // call 0 — totals (no dimensions)
    const totalsBody = calls[0][0].requestBody;
    expect(totalsBody.dimensions).toBeUndefined();

    // call 1 — date series
    const dateBody = calls[1][0].requestBody;
    expect(dateBody.dimensions).toEqual(['date']);

    // call 2 — query dimension
    const queryBody = calls[2][0].requestBody;
    expect(queryBody.dimensions).toEqual(['query']);
  });
});

// ── positionPrev matching ─────────────────────────────────────────────────────

describe('positionPrev matching', () => {
  it('matches query strings across period and comparison, null when no comparison match', async () => {
    setupHappyPath();

    const result = await fetchGsc('sc-domain:example.com', period, comparison);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { queries } = result.data;

    expect(queries).toHaveLength(3);

    // 'best practices seo' matched in both — positionPrev set
    const q1 = queries.find(q => q.query === 'best practices seo');
    expect(q1).toBeDefined();
    expect(q1!.position).toBeCloseTo(5.2);
    expect(q1!.positionPrev).toBeCloseTo(6.1);

    // 'seo audit tool' matched in both — positionPrev set
    const q2 = queries.find(q => q.query === 'seo audit tool');
    expect(q2).toBeDefined();
    expect(q2!.position).toBeCloseTo(8.7);
    expect(q2!.positionPrev).toBeCloseTo(9.3);

    // 'only in period' — no comparison match → positionPrev null
    const q3 = queries.find(q => q.query === 'only in period');
    expect(q3).toBeDefined();
    expect(q3!.position).toBeCloseTo(12.0);
    expect(q3!.positionPrev).toBeNull();
  });
});

// ── error taxonomy ────────────────────────────────────────────────────────────

describe('error taxonomy', () => {
  it('maps a thrown 401 error to reason:"auth"', async () => {
    const err = Object.assign(new Error('Unauthorized'), { code: 401 });
    mockQuery.mockRejectedValue(err);

    const result = await fetchGsc('sc-domain:example.com', period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('auth');
    }
  });

  it('maps a 403/PERMISSION_DENIED to reason:"unmapped" (SA not a user of this site)', async () => {
    const err = Object.assign(new Error('Forbidden'), {
      code: 403,
      errors: [{ status: 'PERMISSION_DENIED' }],
    });
    mockQuery.mockRejectedValue(err);

    const result = await fetchGsc('sc-domain:example.com', period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unmapped');
    }
  });

  it('maps a 403/RESOURCE_EXHAUSTED to reason:"quota" (quota wins over unmapped)', async () => {
    const err = Object.assign(new Error('Resource exhausted'), {
      code: 403,
      errors: [{ status: 'RESOURCE_EXHAUSTED' }],
    });
    mockQuery.mockRejectedValue(err);

    const result = await fetchGsc('sc-domain:example.com', period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('quota');
    }
  });

  it('maps a 429 error to reason:"quota"', async () => {
    const err = Object.assign(new Error('Too many requests'), { code: 429 });
    mockQuery.mockRejectedValue(err);

    const result = await fetchGsc('sc-domain:example.com', period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('quota');
    }
  });

  it('maps a generic unknown error to reason:"error"', async () => {
    const err = new Error('Something went wrong');
    mockQuery.mockRejectedValue(err);

    const result = await fetchGsc('sc-domain:example.com', period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('error');
    }
  });

  it('maps a 429 carried via response.status to reason:"quota"', async () => {
    const err = Object.assign(new Error('Too many requests'), {
      response: { status: 429 },
    });
    mockQuery.mockRejectedValue(err);

    const result = await fetchGsc('sc-domain:example.com', period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('quota');
    }
  });

  it('maps RESOURCE_EXHAUSTED in response.data.error.status to reason:"quota"', async () => {
    const err = Object.assign(new Error('Quota exceeded'), {
      code: 429,
      response: { data: { error: { status: 'RESOURCE_EXHAUSTED' } } },
    });
    mockQuery.mockRejectedValue(err);

    const result = await fetchGsc('sc-domain:example.com', period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('quota');
    }
  });
});

// ── empty rows ─────────────────────────────────────────────────────────────────

describe('empty / missing rows', () => {
  it('handles query responses with no rows (null/undefined/empty)', async () => {
    mockQuery.mockResolvedValue({ data: { rows: null } });

    const result = await fetchGsc('sc-domain:example.com', period, comparison);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.totals.clicks).toBe(0);
    expect(result.data.totals.impressions).toBe(0);
    expect(result.data.clicksSeries).toEqual([]);
    expect(result.data.clicksSeriesPrev).toEqual([]);
    expect(result.data.impressionsSeries).toEqual([]);
    expect(result.data.impressionsSeriesPrev).toEqual([]);
    expect(result.data.positionSeries).toEqual([]);
    expect(result.data.positionSeriesPrev).toEqual([]);
    expect(result.data.queries).toEqual([]);
  });
});
