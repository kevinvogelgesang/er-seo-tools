import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

// ── Mock the helper ───────────────────────────────────────────────────────────
// vi.mock is hoisted, so use vi.hoisted() to declare the spy before the factory.

const { mockGetClientSeoHistory } = vi.hoisted(() => ({
  mockGetClientSeoHistory: vi.fn(),
}));

vi.mock('@/lib/services/client-seo-history', () => ({
  getClientSeoHistory: mockGetClientSeoHistory,
}));

// ── Helper ────────────────────────────────────────────────────────────────────

function req(url: string): NextRequest {
  return new NextRequest(url);
}

async function callGET(id: string) {
  return GET(req(`http://localhost/api/clients/${id}/seo-history`), {
    params: Promise.resolve({ id }),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/clients/[id]/seo-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await callGET('abc');
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('invalid_client_id');
    expect(mockGetClientSeoHistory).not.toHaveBeenCalled();
  });

  it('returns 400 for id="0"', async () => {
    const res = await callGET('0');
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('invalid_client_id');
  });

  it('returns 400 for a negative id', async () => {
    const res = await callGET('-5');
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('invalid_client_id');
  });

  it('returns 404 when client is not found', async () => {
    mockGetClientSeoHistory.mockResolvedValue({
      client: null,
      sessions: [],
      latestTwo: null,
      lastAuditedAt: null,
    });

    const res = await callGET('42');
    expect(res.status).toBe(404);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('not_found');
    expect(mockGetClientSeoHistory).toHaveBeenCalledWith(42);
  });

  it('returns 200 with the helper data when client exists', async () => {
    const mockData = {
      client: { id: 7, name: 'Acme Corp' },
      sessions: [
        {
          id: 'sess-abc',
          createdAt: '2025-06-01T00:00:00.000Z',
          siteName: 'acme.com',
          siteHost: 'acme.com',
          totalUrls: 120,
          criticalCount: 3,
          warningCount: 8,
          noticeCount: 15,
        },
      ],
      latestTwo: null,
      lastAuditedAt: '2025-06-01T00:00:00.000Z',
    };
    mockGetClientSeoHistory.mockResolvedValue(mockData);

    const res = await callGET('7');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(mockData);
    expect(mockGetClientSeoHistory).toHaveBeenCalledWith(7);
  });

  it('returns 200 with latestTwo set when ≥2 sessions', async () => {
    const mockData = {
      client: { id: 8, name: 'Beta Corp' },
      sessions: [
        { id: 'a', createdAt: '2024-01-01T00:00:00.000Z', siteName: null, siteHost: null, totalUrls: null, criticalCount: null, warningCount: null, noticeCount: null },
        { id: 'b', createdAt: '2025-01-01T00:00:00.000Z', siteName: null, siteHost: null, totalUrls: null, criticalCount: null, warningCount: null, noticeCount: null },
      ],
      latestTwo: ['a', 'b'] as [string, string],
      lastAuditedAt: '2025-01-01T00:00:00.000Z',
    };
    mockGetClientSeoHistory.mockResolvedValue(mockData);

    const res = await callGET('8');
    expect(res.status).toBe(200);
    const json = await res.json() as { latestTwo: [string, string] };
    expect(json.latestTwo).toEqual(['a', 'b']);
  });
});
