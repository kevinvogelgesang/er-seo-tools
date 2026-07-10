import 'server-only';

import { google } from 'googleapis';
import { getAuthClient } from './auth';
import { formatYmd } from '../dates';
import type { DateWindow } from '../dates';
import type { SourceResult, GscBundle, GscTotals } from '../types';

// ─── Error classifier ─────────────────────────────────────────────────────────

/**
 * Classify a googleapis API error into the SourceResult reason taxonomy.
 *
 * Priority order (most-specific first):
 *   1. RESOURCE_EXHAUSTED (quota) — checked before status codes so a 403
 *      carrying RESOURCE_EXHAUSTED becomes 'quota', not 'unmapped'.
 *   2. 429 — always quota.
 *   3. 401 — always auth.
 *   4. 403/PERMISSION_DENIED — per-site access gap → 'unmapped'.
 *   5. Generic 403 — treat as unmapped (SA not a user of this site).
 *   6. Everything else → 'error'.
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

  // 4. 403 + PERMISSION_DENIED — unmapped (SA lacks access to this site)
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

// ─── Row helpers ──────────────────────────────────────────────────────────────

/** A raw row returned by the GSC searchanalytics.query API */
type GscRow = {
  keys?: string[] | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
};

function rowsFrom(response: { data?: { rows?: GscRow[] | null } | null }): GscRow[] {
  return response.data?.rows ?? [];
}

function numField(row: GscRow, field: keyof GscRow): number {
  const v = row[field];
  if (typeof v === 'number' && !isNaN(v)) return v;
  return 0;
}

// ─── Totals mapping ───────────────────────────────────────────────────────────

function mapTotals(response: { data?: { rows?: GscRow[] | null } | null }): GscTotals {
  const rs = rowsFrom(response);
  if (rs.length === 0) {
    return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  }
  const row = rs[0];
  return {
    clicks: numField(row, 'clicks'),
    impressions: numField(row, 'impressions'),
    ctr: numField(row, 'ctr'),
    position: numField(row, 'position'),
  };
}

// ─── Main fetch function ──────────────────────────────────────────────────────

/**
 * Fetch a GscBundle for the given site URL over two date windows.
 *
 * Issues 3 searchanalytics.query calls for the period window, then 3 for the
 * comparison window:
 *   1. Totals (no dimensions)
 *   2. Date series (dimensions: ['date'])
 *   3. Top queries (dimensions: ['query'], rowLimit: 100)
 *
 * The siteUrl is passed VERBATIM — never normalized.
 * 'sc-domain:example.com' and 'https://example.com/' are different GSC properties.
 *
 * Returns:
 *   {ok:true, data: GscBundle}    on success
 *   {ok:false, reason:'unmapped'} when siteUrl is null (checked before auth)
 *   {ok:false, reason:'auth'}     when auth fails or API returns 401
 *   {ok:false, reason:'unmapped'} when API returns 403/PERMISSION_DENIED (SA not a user of this site)
 *   {ok:false, reason:'quota'}    when API returns 429 or RESOURCE_EXHAUSTED
 *   {ok:false, reason:'error'}    for all other failures
 */
export async function fetchGsc(
  siteUrl: string | null,
  period: DateWindow,
  comparison: DateWindow,
): Promise<SourceResult<GscBundle>> {
  // ── 1. null-siteUrl short-circuit (before auth) ──────────────────────────
  if (siteUrl === null) {
    return { ok: false, reason: 'unmapped', message: 'No GSC site URL mapped for this client' };
  }

  // Capture the narrowed (non-null) siteUrl so closures below see type 'string'.
  const site: string = siteUrl;

  // ── 2. Auth ──────────────────────────────────────────────────────────────
  const a = await getAuthClient();
  if (!a.ok) return a; // propagates {ok:false, reason:'auth'}

  // ── 3. API client ────────────────────────────────────────────────────────
  const sc = google.searchconsole({ version: 'v1', auth: a.auth });

  /**
   * Issue a single searchanalytics.query for the given window.
   * The siteUrl is passed verbatim — NEVER normalized.
   */
  async function runQuery(
    w: DateWindow,
    dimensions?: string[],
    rowLimit?: number,
  ) {
    return sc.searchanalytics.query({
      siteUrl: site,
      requestBody: {
        startDate: formatYmd(w.start),
        endDate: formatYmd(w.end),
        ...(dimensions && dimensions.length > 0 ? { dimensions } : {}),
        ...(rowLimit !== undefined ? { rowLimit } : {}),
      },
    });
  }

  // ── 4. Fetch all groups ──────────────────────────────────────────────────
  try {
    // ── Period window ──────────────────────────────────────────────────────
    const [pTotalsRes, pDateRes, pQueryRes] = await Promise.all([
      runQuery(period),
      runQuery(period, ['date']),
      runQuery(period, ['query'], 100),
    ]);

    // ── Comparison window ──────────────────────────────────────────────────
    const [cTotalsRes, cDateRes, cQueryRes] = await Promise.all([
      runQuery(comparison),
      runQuery(comparison, ['date']),
      runQuery(comparison, ['query'], 100),
    ]);

    // ── 5. Map into GscBundle ──────────────────────────────────────────────

    const totals = mapTotals(pTotalsRes);
    const comparisonTotals = mapTotals(cTotalsRes);

    // Date series — period
    const pDateRows = rowsFrom(pDateRes);
    const clicksSeries = pDateRows.map(r => ({
      date: r.keys?.[0] ?? '',
      value: numField(r, 'clicks'),
    }));
    const impressionsSeries = pDateRows.map(r => ({
      date: r.keys?.[0] ?? '',
      value: numField(r, 'impressions'),
    }));
    const positionSeries = pDateRows.map(r => ({
      date: r.keys?.[0] ?? '',
      value: numField(r, 'position'),
    }));

    // Date series — comparison
    const cDateRows = rowsFrom(cDateRes);
    const clicksSeriesPrev = cDateRows.map(r => ({
      date: r.keys?.[0] ?? '',
      value: numField(r, 'clicks'),
    }));
    const impressionsSeriesPrev = cDateRows.map(r => ({
      date: r.keys?.[0] ?? '',
      value: numField(r, 'impressions'),
    }));
    const positionSeriesPrev = cDateRows.map(r => ({
      date: r.keys?.[0] ?? '',
      value: numField(r, 'position'),
    }));

    // Query dimension — build positionPrev lookup from comparison
    const compQueryMap = new Map<string, number>();
    for (const row of rowsFrom(cQueryRes)) {
      const q = row.keys?.[0];
      if (q !== undefined && q !== null) {
        compQueryMap.set(q, numField(row, 'position'));
      }
    }

    const queries = rowsFrom(pQueryRes).map(row => {
      const q = row.keys?.[0] ?? '';
      const position = numField(row, 'position');
      const positionPrev = compQueryMap.has(q) ? (compQueryMap.get(q) ?? null) : null;
      return { query: q, position, positionPrev };
    });

    return {
      ok: true,
      data: {
        totals,
        comparisonTotals,
        clicksSeries,
        clicksSeriesPrev,
        impressionsSeries,
        impressionsSeriesPrev,
        positionSeries,
        positionSeriesPrev,
        queries,
      },
    };
  } catch (err) {
    return classifyApiError(err);
  }
}

// ─── Query × page snapshot (KS-1) ──────────────────────────────────────────────

/** Row limit for the `['query']`-dimensioned searchanalytics.query call. */
const QUERY_ROW_LIMIT = 2500;

/** Row limit for the `['query', 'page']`-dimensioned searchanalytics.query call. */
const QUERY_PAGE_ROW_LIMIT = 5000;

export type GscQueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscQueryPageRow = {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number;
};

export type GscQueryPageResult =
  | {
      ok: true;
      data: {
        queryRows: GscQueryRow[];
        queryPageRows: GscQueryPageRow[];
        queryAtLimit: boolean;
        queryPageAtLimit: boolean;
      };
    }
  | {
      ok: false;
      reason: 'not_mapped' | 'access_denied' | 'auth' | 'quota' | 'error';
      message?: string;
    };

function mapQueryRows(rows: GscRow[]): GscQueryRow[] {
  const out: GscQueryRow[] = [];
  for (const row of rows) {
    const query = row.keys?.[0];
    if (query === null || query === undefined) continue;
    out.push({
      query,
      clicks: numField(row, 'clicks'),
      impressions: numField(row, 'impressions'),
      ctr: numField(row, 'ctr'),
      position: numField(row, 'position'),
    });
  }
  return out;
}

function mapQueryPageRows(rows: GscRow[]): GscQueryPageRow[] {
  const out: GscQueryPageRow[] = [];
  for (const row of rows) {
    const query = row.keys?.[0];
    const page = row.keys?.[1];
    if (query === null || query === undefined || page === null || page === undefined) continue;
    out.push({
      query,
      page,
      clicks: numField(row, 'clicks'),
      impressions: numField(row, 'impressions'),
      position: numField(row, 'position'),
    });
  }
  return out;
}

/**
 * Fetch a query×page keyword snapshot for a single date window.
 *
 * Issues 2 searchanalytics.query calls (in parallel via Promise.all):
 *   1. dimensions:['query'], rowLimit:2500
 *   2. dimensions:['query','page'], rowLimit:5000
 * Each call passes `{ timeout: 30_000 }` as the request-options argument.
 *
 * The siteUrl is passed VERBATIM — never normalized (same doctrine as fetchGsc).
 *
 * Own result union (NOT the shared SourceResult): the shared 'unmapped' reason
 * conflates local-null-siteUrl with an API 403. Here they are distinct facts:
 *   - {ok:false, reason:'not_mapped'}   siteUrl is null — checked before auth, zero API calls
 *   - {ok:false, reason:'access_denied'} classifyApiError → 'unmapped' (403/PERMISSION_DENIED
 *     or generic 403) on what IS a configured property — the service account just lacks access
 *   - {ok:false, reason:'auth'|'quota'|'error'} pass through classifyApiError/getAuthClient unchanged
 */
export async function fetchGscQueryPage(
  siteUrl: string | null,
  window: DateWindow,
): Promise<GscQueryPageResult> {
  // ── 1. null-siteUrl short-circuit (before auth) ──────────────────────────
  if (siteUrl === null) {
    return { ok: false, reason: 'not_mapped', message: 'No GSC site URL mapped for this client' };
  }

  const site: string = siteUrl;

  // ── 2. Auth ──────────────────────────────────────────────────────────────
  const a = await getAuthClient();
  if (!a.ok) return a; // {ok:false, reason:'auth', message} — same shape, passes through

  // ── 3. API client ────────────────────────────────────────────────────────
  const sc = google.searchconsole({ version: 'v1', auth: a.auth });

  async function runQuery(dimensions: string[], rowLimit: number) {
    return sc.searchanalytics.query(
      {
        siteUrl: site,
        requestBody: {
          startDate: formatYmd(window.start),
          endDate: formatYmd(window.end),
          dimensions,
          rowLimit,
        },
      },
      { timeout: 30_000 },
    );
  }

  // ── 4. Fetch both dimensions in parallel ─────────────────────────────────
  try {
    const [queryRes, queryPageRes] = await Promise.all([
      runQuery(['query'], QUERY_ROW_LIMIT),
      runQuery(['query', 'page'], QUERY_PAGE_ROW_LIMIT),
    ]);

    const rawQueryRows = rowsFrom(queryRes);
    const rawQueryPageRows = rowsFrom(queryPageRes);

    return {
      ok: true,
      data: {
        queryRows: mapQueryRows(rawQueryRows),
        queryPageRows: mapQueryPageRows(rawQueryPageRows),
        // "At limit" means the raw API response hit the row cap — computed from
        // the raw row count BEFORE null-key rows are discarded, since that raw
        // count is what "the API stopped here" actually measures.
        queryAtLimit: rawQueryRows.length === QUERY_ROW_LIMIT,
        queryPageAtLimit: rawQueryPageRows.length === QUERY_PAGE_ROW_LIMIT,
      },
    };
  } catch (err) {
    const classified = classifyApiError(err);
    // classifyApiError always returns the ok:false branch; narrow explicitly
    // so TS knows `reason`/`message` are present.
    if (!classified.ok) {
      if (classified.reason === 'unmapped') {
        return { ok: false, reason: 'access_denied', message: classified.message };
      }
      return { ok: false, reason: classified.reason, message: classified.message };
    }
    // Unreachable: classifyApiError never returns ok:true.
    return { ok: false, reason: 'error', message: 'unexpected classifier result' };
  }
}
