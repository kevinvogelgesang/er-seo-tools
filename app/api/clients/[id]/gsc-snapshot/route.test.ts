import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import type { GscSnapshotSummary } from '@/lib/keywords/gsc-snapshot';

// ── Mock the service ────────────────────────────────────────────────────────
// vi.mock is hoisted, so use vi.hoisted() to declare the spies before the factory.

const { mockRefreshGscSnapshot, mockGetLatestGscSnapshot } = vi.hoisted(() => ({
  mockRefreshGscSnapshot: vi.fn(),
  mockGetLatestGscSnapshot: vi.fn(),
}));

vi.mock('@/lib/keywords/gsc-snapshot', () => ({
  refreshGscSnapshot: mockRefreshGscSnapshot,
  getLatestGscSnapshot: mockGetLatestGscSnapshot,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function req(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, init);
}

async function callGET(id: string) {
  return GET(req(`http://localhost/api/clients/${id}/gsc-snapshot`), {
    params: Promise.resolve({ id }),
  });
}

async function callPOST(id: string) {
  return POST(req(`http://localhost/api/clients/${id}/gsc-snapshot`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });
}

const SAMPLE_SUMMARY: GscSnapshotSummary = {
  fetchedAt: '2026-07-10T00:00:00.000Z',
  gscSiteUrl: 'sc-domain:example.com',
  window: { start: '2026-06-10T00:00:00.000Z', end: '2026-07-10T00:00:00.000Z' },
  thresholds: { minImpressions: 10, winMaxPosition: 10, opportunityMinPosition: 11, opportunityMaxPosition: 20, quickWinMinPosition: 4, quickWinMaxPosition: 10 } as unknown as GscSnapshotSummary['thresholds'],
  counts: { wins: 1, opportunities: 2, quickWins: 3, cannibalization: 0 } as unknown as GscSnapshotSummary['counts'],
  queryAtLimit: false,
  queryPageAtLimit: false,
  wins: [],
  opportunities: [],
  quickWins: [],
  cannibalization: [],
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/clients/[id]/gsc-snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await callGET('abc');
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: 'Invalid client ID' });
    expect(mockGetLatestGscSnapshot).not.toHaveBeenCalled();
  });

  it('returns 200 with { gscMapped, summary } passthrough', async () => {
    mockGetLatestGscSnapshot.mockResolvedValue({ gscMapped: true, summary: SAMPLE_SUMMARY });

    const res = await callGET('7');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ gscMapped: true, summary: SAMPLE_SUMMARY });
    expect(mockGetLatestGscSnapshot).toHaveBeenCalledWith(7);
  });

  it('returns 200 with gscMapped:false, summary:null when unmapped', async () => {
    mockGetLatestGscSnapshot.mockResolvedValue({ gscMapped: false, summary: null });

    const res = await callGET('9');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ gscMapped: false, summary: null });
  });
});

describe('POST /api/clients/[id]/gsc-snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await callPOST('abc');
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: 'Invalid client ID' });
    expect(mockRefreshGscSnapshot).not.toHaveBeenCalled();
  });

  it('returns 200 with { summary } on ok:true', async () => {
    mockRefreshGscSnapshot.mockResolvedValue({ ok: true, summary: SAMPLE_SUMMARY });

    const res = await callPOST('7');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ summary: SAMPLE_SUMMARY });
    expect(mockRefreshGscSnapshot).toHaveBeenCalledWith(7);
  });

  it('returns 404 { error: "Client not found" } for client_not_found', async () => {
    mockRefreshGscSnapshot.mockResolvedValue({ ok: false, reason: 'client_not_found' });

    const res = await callPOST('42');
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ error: 'Client not found' });
  });

  it('returns 409 { error: "gsc_not_mapped" } for not_mapped', async () => {
    mockRefreshGscSnapshot.mockResolvedValue({
      ok: false,
      reason: 'not_mapped',
      message: 'No GSC site URL mapped for this client',
    });

    const res = await callPOST('7');
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toEqual({
      error: 'gsc_not_mapped',
      message: 'No GSC site URL mapped for this client',
    });
  });

  it('returns 409 { error: "gsc_access_denied" } for access_denied', async () => {
    mockRefreshGscSnapshot.mockResolvedValue({ ok: false, reason: 'access_denied' });

    const res = await callPOST('7');
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toEqual({ error: 'gsc_access_denied' });
  });

  it('returns 429 { error: "gsc_quota" } for quota', async () => {
    mockRefreshGscSnapshot.mockResolvedValue({ ok: false, reason: 'quota' });

    const res = await callPOST('7');
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json).toEqual({ error: 'gsc_quota' });
  });

  it('returns 502 { error: "gsc_auth" } for auth', async () => {
    mockRefreshGscSnapshot.mockResolvedValue({ ok: false, reason: 'auth' });

    const res = await callPOST('7');
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json).toEqual({ error: 'gsc_auth' });
  });

  it('returns 502 { error: "gsc_error" } for error', async () => {
    mockRefreshGscSnapshot.mockResolvedValue({ ok: false, reason: 'error', message: 'boom' });

    const res = await callPOST('7');
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json).toEqual({ error: 'gsc_error', message: 'boom' });
  });

  it('returns 500 { error: "internal_error" } when the service throws (withRoute net)', async () => {
    mockRefreshGscSnapshot.mockRejectedValueOnce(new Error('unexpected'));

    const res = await callPOST('7');
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });
  });
});
