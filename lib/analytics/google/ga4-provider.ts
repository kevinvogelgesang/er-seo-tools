import 'server-only';

import { google } from 'googleapis';
import { getAuthClient } from './auth';
import { formatYmd } from '../dates';
import type { DateWindow } from '../dates';
import type { SourceResult, Ga4Bundle, Ga4Totals } from '../types';

// ─── Error classifier ─────────────────────────────────────────────────────────

/**
 * Classify a googleapis API error into the SourceResult reason taxonomy.
 *
 * Priority order (most-specific first):
 *   1. RESOURCE_EXHAUSTED (quota) — checked before status codes so a 403
 *      carrying RESOURCE_EXHAUSTED becomes 'quota', not 'unmapped'.
 *   2. 429 — always quota.
 *   3. 401 — always auth.
 *   4. 403/PERMISSION_DENIED — per-property access gap → 'unmapped'.
 *   5. Everything else → 'error'.
 */
function classifyApiError(err: unknown): SourceResult<never> {
  if (!err || typeof err !== 'object') {
    return { ok: false, reason: 'error', message: String(err) };
  }

  const e = err as Record<string, unknown>;
  const message = typeof e.message === 'string' ? e.message : undefined;

  // Normalise numeric HTTP status from either err.code or err.response?.status
  const rawCode = e.code;
  const rawResponseStatus =
    e.response && typeof e.response === 'object'
      ? (e.response as Record<string, unknown>).status
      : undefined;
  const httpStatus =
    typeof rawCode === 'number' ? rawCode
    : typeof rawResponseStatus === 'number' ? rawResponseStatus
    : undefined;

  // Normalise RESOURCE_EXHAUSTED / PERMISSION_DENIED from:
  //   err.errors[0].status  (common googleapis error array)
  //   err.response.data.error.status  (alternate shape)
  function extractStatusString(): string | undefined {
    const errors = e.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0] as Record<string, unknown>;
      if (typeof first.status === 'string') return first.status;
    }
    const resp = e.response as Record<string, unknown> | undefined;
    const data = resp?.data as Record<string, unknown> | undefined;
    const apiErr = data?.error as Record<string, unknown> | undefined;
    if (typeof apiErr?.status === 'string') return apiErr.status;
    return undefined;
  }

  const statusStr = extractStatusString();

  // 1. RESOURCE_EXHAUSTED wins regardless of HTTP status code
  if (statusStr === 'RESOURCE_EXHAUSTED') {
    return { ok: false, reason: 'quota', message };
  }

  // 2. 429 — quota
  if (httpStatus === 429) {
    return { ok: false, reason: 'quota', message };
  }

  // 3. 401 — auth
  if (httpStatus === 401) {
    return { ok: false, reason: 'auth', message };
  }

  // 4. 403 + PERMISSION_DENIED — unmapped (SA lacks access to this property)
  if (httpStatus === 403 && statusStr === 'PERMISSION_DENIED') {
    return { ok: false, reason: 'unmapped', message };
  }

  // 5. Generic 403 without a known status string — treat as unmapped
  if (httpStatus === 403) {
    return { ok: false, reason: 'unmapped', message };
  }

  // 6. Everything else
  return { ok: false, reason: 'error', message };
}

// ─── GA4 metric/dimension constants ─────────────────────────────────────────

const TOTALS_METRICS = [
  { name: 'sessions' },
  { name: 'engagedSessions' },
  { name: 'averageSessionDuration' },
  { name: 'eventsPerSession' },
  { name: 'bounceRate' },
  { name: 'keyEvents' },
];

const SERIES_METRICS = [{ name: 'sessions' }];
const SERIES_DIMENSIONS = [{ name: 'date' }];

const LANDING_METRICS = [{ name: 'sessions' }, { name: 'keyEvents' }];
const LANDING_DIMENSIONS = [{ name: 'landingPagePlusQueryString' }];

const CITIES_METRICS = [{ name: 'sessions' }, { name: 'keyEvents' }];
const CITIES_DIMENSIONS = [{ name: 'city' }];

const NVR_METRICS = [{ name: 'sessions' }];
const NVR_DIMENSIONS = [{ name: 'newVsReturning' }];

const DEVICES_METRICS = [{ name: 'sessions' }];
const DEVICES_DIMENSIONS = [{ name: 'deviceCategory' }];

// ─── Row helpers ─────────────────────────────────────────────────────────────

type RunReportRow = {
  dimensionValues?: Array<{ value?: string | null }> | null;
  metricValues?: Array<{ value?: string | null }> | null;
};

function metricNum(row: RunReportRow, index: number): number {
  const v = row.metricValues?.[index]?.value;
  if (v == null) return 0;
  return parseFloat(v) || 0;
}

function dimStr(row: RunReportRow, index: number): string {
  return row.dimensionValues?.[index]?.value ?? '';
}

function rows(response: { data?: { rows?: RunReportRow[] | null } | null }): RunReportRow[] {
  return response.data?.rows ?? [];
}

// ─── Totals mapping ──────────────────────────────────────────────────────────

function mapTotals(response: { data?: { rows?: RunReportRow[] | null } | null }): Ga4Totals {
  const rs = rows(response);
  if (rs.length === 0) {
    return {
      sessions: 0,
      engagedSessions: 0,
      averageSessionDuration: 0,
      eventsPerSession: 0,
      bounceRate: 0,
      keyEvents: 0,
    };
  }
  const row = rs[0];
  return {
    sessions: metricNum(row, 0),
    engagedSessions: metricNum(row, 1),
    averageSessionDuration: metricNum(row, 2),
    eventsPerSession: metricNum(row, 3),
    bounceRate: metricNum(row, 4),
    keyEvents: metricNum(row, 5),
  };
}

// ─── Main fetch function ──────────────────────────────────────────────────────

/**
 * Fetch a GA4Bundle for the given property over two date windows.
 *
 * Issues 6 runReport calls for the period window, then 6 for the comparison
 * window (one per metric group — no dual-dateRanges, per Codex fix #9).
 *
 * Returns:
 *   {ok:true, data: Ga4Bundle}    on success
 *   {ok:false, reason:'unmapped'} when propertyId is null (checked before auth)
 *   {ok:false, reason:'auth'}     when auth fails or API returns 401
 *   {ok:false, reason:'unmapped'} when API returns 403/PERMISSION_DENIED
 *   {ok:false, reason:'quota'}    when API returns 429 or RESOURCE_EXHAUSTED
 *   {ok:false, reason:'error'}    for all other failures
 */
export async function fetchGa4(
  propertyId: string | null,
  period: DateWindow,
  comparison: DateWindow,
): Promise<SourceResult<Ga4Bundle>> {
  // ── 1. null-propertyId short-circuit (before auth) ──────────────────────
  if (propertyId === null) {
    return { ok: false, reason: 'unmapped', message: 'No GA4 property ID mapped for this client' };
  }

  // ── 2. Auth ──────────────────────────────────────────────────────────────
  const a = await getAuthClient();
  if (!a.ok) return a; // propagates {ok:false, reason:'auth'}

  // ── 3. API client ────────────────────────────────────────────────────────
  const analyticsData = google.analyticsdata({ version: 'v1beta', auth: a.auth });
  const property = `properties/${propertyId}`;

  /**
   * Issue a single runReport for the given window.
   * Throws on API error (caught at the top level).
   */
  async function runReport(
    w: DateWindow,
    metrics: Array<{ name: string }>,
    dimensions?: Array<{ name: string }>,
  ) {
    return analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate: formatYmd(w.start), endDate: formatYmd(w.end) }],
        metrics,
        ...(dimensions && dimensions.length > 0 ? { dimensions } : {}),
      },
    });
  }

  // ── 4. Fetch all groups ──────────────────────────────────────────────────
  try {
    // ── Period window ──────────────────────────────────────────────────────
    const [
      pTotalsRes,
      pSeriesRes,
      pLandingRes,
      pCitiesRes,
      pNvRRes,
      pDevicesRes,
    ] = await Promise.all([
      runReport(period, TOTALS_METRICS),
      runReport(period, SERIES_METRICS, SERIES_DIMENSIONS),
      runReport(period, LANDING_METRICS, LANDING_DIMENSIONS),
      runReport(period, CITIES_METRICS, CITIES_DIMENSIONS),
      runReport(period, NVR_METRICS, NVR_DIMENSIONS),
      runReport(period, DEVICES_METRICS, DEVICES_DIMENSIONS),
    ]);

    // ── Comparison window ──────────────────────────────────────────────────
    const [
      cTotalsRes,
      cSeriesRes,
      // landing/cities/donuts from period window only per spec §4
      // (comparison data fetched but not surfaced in the bundle except totals + series)
    ] = await Promise.all([
      runReport(comparison, TOTALS_METRICS),
      runReport(comparison, SERIES_METRICS, SERIES_DIMENSIONS),
      runReport(comparison, LANDING_METRICS, LANDING_DIMENSIONS),
      runReport(comparison, CITIES_METRICS, CITIES_DIMENSIONS),
      runReport(comparison, NVR_METRICS, NVR_DIMENSIONS),
      runReport(comparison, DEVICES_METRICS, DEVICES_DIMENSIONS),
    ]);

    // ── 5. Map into Ga4Bundle ──────────────────────────────────────────────

    const totals = mapTotals(pTotalsRes);
    const comparisonTotals = mapTotals(cTotalsRes);

    const sessionsSeries = rows(pSeriesRes).map(r => ({
      date: dimStr(r, 0),
      value: metricNum(r, 0),
    }));

    const sessionsSeriesPrev = rows(cSeriesRes).map(r => ({
      date: dimStr(r, 0),
      value: metricNum(r, 0),
    }));

    const landingPages = rows(pLandingRes).map(r => ({
      path: dimStr(r, 0),
      sessions: metricNum(r, 0),
      keyEvents: metricNum(r, 1),
    }));

    const cities = rows(pCitiesRes).map(r => ({
      city: dimStr(r, 0),
      sessions: metricNum(r, 0),
      keyEvents: metricNum(r, 1),
    }));

    const newVsReturning = rows(pNvRRes).map(r => ({
      label: dimStr(r, 0),
      sessions: metricNum(r, 0),
    }));

    const devices = rows(pDevicesRes).map(r => ({
      label: dimStr(r, 0),
      sessions: metricNum(r, 0),
    }));

    return {
      ok: true,
      data: {
        totals,
        comparisonTotals,
        sessionsSeries,
        sessionsSeriesPrev,
        landingPages,
        cities,
        newVsReturning,
        devices,
      },
    };
  } catch (err) {
    return classifyApiError(err);
  }
}
