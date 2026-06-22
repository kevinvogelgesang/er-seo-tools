import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── hoist mocks so vi.mock factories can reference them ─────────────────────
const { mockRunReport, mockGetAuthClient } = vi.hoisted(() => ({
  mockRunReport: vi.fn(),
  mockGetAuthClient: vi.fn(),
}));

// ─── mock 'googleapis' before any import that uses it ──────────────────────
vi.mock('googleapis', () => {
  const analyticsDataFn = vi.fn().mockReturnValue({
    properties: { runReport: mockRunReport },
  });
  return {
    google: {
      analyticsdata: analyticsDataFn,
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

import { fetchGa4 } from './ga4-provider';
import type { DateWindow } from '../dates';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeWindow(start: string, end: string): DateWindow {
  return { start: new Date(start), end: new Date(end) };
}

const period = makeWindow('2026-05-01', '2026-05-31');
const comparison = makeWindow('2026-04-01', '2026-04-30');

const MOCK_AUTH = { ok: true as const, auth: {} as never };

/** Minimal valid runReport response for a TOTALS call */
function makeTotalsResponse(overrides?: Partial<{
  sessions: string;
  engagedSessions: string;
  averageSessionDuration: string;
  eventsPerSession: string;
  bounceRate: string;
  keyEvents: string;
}>) {
  const v = {
    sessions: '1000',
    engagedSessions: '700',
    averageSessionDuration: '120.5',
    eventsPerSession: '3.5',
    bounceRate: '0.35',
    keyEvents: '50',
    ...overrides,
  };
  return {
    data: {
      rows: [
        {
          metricValues: [
            { value: v.sessions },
            { value: v.engagedSessions },
            { value: v.averageSessionDuration },
            { value: v.eventsPerSession },
            { value: v.bounceRate },
            { value: v.keyEvents },
          ],
        },
      ],
    },
  };
}

/** Minimal valid runReport response for a SESSIONS-BY-DATE series call */
function makeSeriesResponse(rows: Array<{ date: string; sessions: string }>) {
  return {
    data: {
      rows: rows.map(r => ({
        dimensionValues: [{ value: r.date }],
        metricValues: [{ value: r.sessions }],
      })),
    },
  };
}

/** Minimal valid runReport response for a LANDING PAGES call */
function makeLandingPagesResponse(
  rows: Array<{ path: string; sessions: string; keyEvents: string }>
) {
  return {
    data: {
      rows: rows.map(r => ({
        dimensionValues: [{ value: r.path }],
        metricValues: [{ value: r.sessions }, { value: r.keyEvents }],
      })),
    },
  };
}

/** Minimal valid runReport response for a CITIES call */
function makeCitiesResponse(rows: Array<{ city: string; sessions: string; keyEvents: string }>) {
  return {
    data: {
      rows: rows.map(r => ({
        dimensionValues: [{ value: r.city }],
        metricValues: [{ value: r.sessions }, { value: r.keyEvents }],
      })),
    },
  };
}

/** Minimal valid runReport response for a donut (label / sessions) call */
function makeDonutResponse(rows: Array<{ label: string; sessions: string }>) {
  return {
    data: {
      rows: rows.map(r => ({
        dimensionValues: [{ value: r.label }],
        metricValues: [{ value: r.sessions }],
      })),
    },
  };
}

/**
 * Set up a full happy-path mock sequence.
 * 6 groups × 2 windows = 12 calls in this order:
 *   period:     totals(0), series(1), landingPages(2), cities(3), newVsReturning(4), devices(5)
 *   comparison: totals(6), series(7), landingPages(8), cities(9), newVsReturning(10), devices(11)
 */
function setupHappyPath() {
  const periodTotals = makeTotalsResponse();
  const compTotals = makeTotalsResponse({
    sessions: '800',
    engagedSessions: '560',
    averageSessionDuration: '100.0',
    eventsPerSession: '3.0',
    bounceRate: '0.40',
    keyEvents: '40',
  });
  const periodSeries = makeSeriesResponse([
    { date: '20260501', sessions: '30' },
    { date: '20260502', sessions: '35' },
  ]);
  const compSeries = makeSeriesResponse([
    { date: '20260401', sessions: '25' },
  ]);
  const periodLanding = makeLandingPagesResponse([
    { path: '/home', sessions: '400', keyEvents: '20' },
    { path: '/about', sessions: '100', keyEvents: '5' },
  ]);
  const compLanding = makeLandingPagesResponse([]);
  const periodCities = makeCitiesResponse([
    { city: 'Vancouver', sessions: '200', keyEvents: '10' },
  ]);
  const compCities = makeCitiesResponse([]);
  const periodNvR = makeDonutResponse([
    { label: 'new', sessions: '600' },
    { label: 'returning', sessions: '400' },
  ]);
  const compNvR = makeDonutResponse([]);
  const periodDevices = makeDonutResponse([
    { label: 'desktop', sessions: '700' },
    { label: 'mobile', sessions: '300' },
  ]);
  const compDevices = makeDonutResponse([]);

  mockRunReport
    .mockResolvedValueOnce(periodTotals)      // 0 — period totals
    .mockResolvedValueOnce(periodSeries)       // 1 — period series
    .mockResolvedValueOnce(periodLanding)      // 2 — period landing pages
    .mockResolvedValueOnce(periodCities)       // 3 — period cities
    .mockResolvedValueOnce(periodNvR)          // 4 — period new vs returning
    .mockResolvedValueOnce(periodDevices)      // 5 — period devices
    .mockResolvedValueOnce(compTotals)         // 6 — comparison totals
    .mockResolvedValueOnce(compSeries)         // 7 — comparison series
    .mockResolvedValueOnce(compLanding)        // 8 — comparison landing pages
    .mockResolvedValueOnce(compCities)         // 9 — comparison cities
    .mockResolvedValueOnce(compNvR)            // 10 — comparison new vs returning
    .mockResolvedValueOnce(compDevices);       // 11 — comparison devices
}

// ─── tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthClient.mockResolvedValue(MOCK_AUTH);
});

// ── null propertyId ───────────────────────────────────────────────────────────

describe('null propertyId', () => {
  it('returns {ok:false, reason:"unmapped"} immediately and never calls runReport', async () => {
    const result = await fetchGa4(null, period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unmapped');
    }
    expect(mockRunReport).not.toHaveBeenCalled();
    // Also never called auth
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

    const result = await fetchGa4('123456789', period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('auth');
    }
    expect(mockRunReport).not.toHaveBeenCalled();
  });
});

// ── happy path ────────────────────────────────────────────────────────────────

describe('happy path', () => {
  it('returns ok:true with a correctly mapped Ga4Bundle', async () => {
    setupHappyPath();

    const result = await fetchGa4('123456789', period, comparison);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const bundle = result.data;

    // totals — period
    expect(bundle.totals.sessions).toBe(1000);
    expect(bundle.totals.engagedSessions).toBe(700);
    expect(bundle.totals.bounceRate).toBeCloseTo(0.35);
    expect(bundle.totals.keyEvents).toBe(50);
    expect(bundle.totals.eventsPerSession).toBeCloseTo(3.5);
    expect(bundle.totals.averageSessionDuration).toBeCloseTo(120.5);

    // comparisonTotals
    expect(bundle.comparisonTotals.sessions).toBe(800);
    expect(bundle.comparisonTotals.keyEvents).toBe(40);

    // sessionsSeries — period
    expect(bundle.sessionsSeries).toHaveLength(2);
    expect(bundle.sessionsSeries[0]).toEqual({ date: '20260501', value: 30 });
    expect(bundle.sessionsSeries[1]).toEqual({ date: '20260502', value: 35 });

    // sessionsSeriesPrev — comparison
    expect(bundle.sessionsSeriesPrev).toHaveLength(1);
    expect(bundle.sessionsSeriesPrev[0]).toEqual({ date: '20260401', value: 25 });

    // landingPages — period
    expect(bundle.landingPages).toHaveLength(2);
    expect(bundle.landingPages[0]).toEqual({ path: '/home', sessions: 400, keyEvents: 20 });
    expect(bundle.landingPages[1]).toEqual({ path: '/about', sessions: 100, keyEvents: 5 });

    // cities — period
    expect(bundle.cities).toHaveLength(1);
    expect(bundle.cities[0]).toEqual({ city: 'Vancouver', sessions: 200, keyEvents: 10 });

    // newVsReturning — period
    expect(bundle.newVsReturning).toHaveLength(2);
    expect(bundle.newVsReturning[0]).toEqual({ label: 'new', sessions: 600 });

    // devices — period
    expect(bundle.devices).toHaveLength(2);
    expect(bundle.devices[0]).toEqual({ label: 'desktop', sessions: 700 });
  });

  it('issues 12 runReport calls total (6 groups × 2 windows)', async () => {
    setupHappyPath();

    await fetchGa4('123456789', period, comparison);

    expect(mockRunReport).toHaveBeenCalledTimes(12);
  });

  it('uses period dates for call 0 and comparison dates for call 6', async () => {
    setupHappyPath();

    await fetchGa4('123456789', period, comparison);

    const calls = mockRunReport.mock.calls;

    // call 0 — period totals
    const call0Body = calls[0][0].requestBody;
    expect(call0Body.dateRanges[0].startDate).toBe('2026-05-01');
    expect(call0Body.dateRanges[0].endDate).toBe('2026-05-31');

    // call 6 — comparison totals (first comparison call)
    const call6Body = calls[6][0].requestBody;
    expect(call6Body.dateRanges[0].startDate).toBe('2026-04-01');
    expect(call6Body.dateRanges[0].endDate).toBe('2026-04-30');
  });

  it('each runReport call uses a single dateRanges entry (Codex fix #9)', async () => {
    setupHappyPath();

    await fetchGa4('123456789', period, comparison);

    for (const call of mockRunReport.mock.calls) {
      const body = call[0].requestBody;
      expect(body.dateRanges).toHaveLength(1);
    }
  });

  it('uses the correct property string for all calls', async () => {
    setupHappyPath();

    await fetchGa4('123456789', period, comparison);

    for (const call of mockRunReport.mock.calls) {
      expect(call[0].property).toBe('properties/123456789');
    }
  });
});

// ── error taxonomy ────────────────────────────────────────────────────────────

describe('error taxonomy', () => {
  it('maps a thrown 401 error to reason:"auth"', async () => {
    const err = Object.assign(new Error('Unauthorized'), { code: 401 });
    mockRunReport.mockRejectedValue(err);

    const result = await fetchGa4('123456789', period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('auth');
    }
  });

  it('maps a thrown 403/PERMISSION_DENIED to reason:"unmapped"', async () => {
    const err = Object.assign(new Error('Forbidden'), {
      code: 403,
      errors: [{ status: 'PERMISSION_DENIED' }],
    });
    mockRunReport.mockRejectedValue(err);

    const result = await fetchGa4('123456789', period, comparison);

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
    mockRunReport.mockRejectedValue(err);

    const result = await fetchGa4('123456789', period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('quota');
    }
  });

  it('maps a 429 error to reason:"quota"', async () => {
    const err = Object.assign(new Error('Too many requests'), { code: 429 });
    mockRunReport.mockRejectedValue(err);

    const result = await fetchGa4('123456789', period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('quota');
    }
  });

  it('maps a 429 carried via response.status to reason:"quota"', async () => {
    const err = Object.assign(new Error('Too many requests'), {
      response: { status: 429 },
    });
    mockRunReport.mockRejectedValue(err);

    const result = await fetchGa4('123456789', period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('quota');
    }
  });

  it('maps a RESOURCE_EXHAUSTED in response.data.error.status to reason:"quota"', async () => {
    const err = Object.assign(new Error('Quota exceeded'), {
      code: 429,
      response: { data: { error: { status: 'RESOURCE_EXHAUSTED' } } },
    });
    mockRunReport.mockRejectedValue(err);

    const result = await fetchGa4('123456789', period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('quota');
    }
  });

  it('maps a generic unknown error to reason:"error"', async () => {
    const err = new Error('Something went wrong');
    mockRunReport.mockRejectedValue(err);

    const result = await fetchGa4('123456789', period, comparison);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('error');
    }
  });
});

// ── empty rows ────────────────────────────────────────────────────────────────

describe('empty / missing rows', () => {
  it('handles runReport responses with no rows (null/undefined/empty)', async () => {
    // Return null rows for all calls — should still produce ok:true with empty arrays
    mockRunReport.mockResolvedValue({ data: { rows: null } });

    const result = await fetchGa4('123456789', period, comparison);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.totals.sessions).toBe(0);
    expect(result.data.sessionsSeries).toEqual([]);
    expect(result.data.landingPages).toEqual([]);
    expect(result.data.cities).toEqual([]);
    expect(result.data.newVsReturning).toEqual([]);
    expect(result.data.devices).toEqual([]);
  });
});
