import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── hoist mocks ─────────────────────────────────────────────────────────────
const { mockSitesList, mockGetAuthClient } = vi.hoisted(() => ({
  mockSitesList: vi.fn(),
  mockGetAuthClient: vi.fn(),
}));

// ─── mock googleapis ──────────────────────────────────────────────────────────
vi.mock('googleapis', () => {
  const searchconsoleFn = vi.fn().mockReturnValue({
    sites: { list: mockSitesList },
  });
  return {
    google: {
      searchconsole: searchconsoleFn,
      auth: { GoogleAuth: vi.fn() },
    },
  };
});

// ─── mock auth helper ─────────────────────────────────────────────────────────
vi.mock('@/lib/analytics/google/auth', () => ({
  getAuthClient: mockGetAuthClient,
}));

import { GET } from './route';
import { NextRequest } from 'next/server';

const MOCK_AUTH = { ok: true as const, auth: {} as never };

function makeReq(): NextRequest {
  return new NextRequest('http://localhost/api/google/gsc-sites');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthClient.mockResolvedValue(MOCK_AUTH);
});

describe('GET /api/google/gsc-sites', () => {
  it('returns [{siteUrl}] array from sites.list', async () => {
    mockSitesList.mockResolvedValue({
      data: {
        siteEntry: [
          { siteUrl: 'sc-domain:example.com' },
          { siteUrl: 'https://www.example.com/' },
        ],
      },
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(2);
    expect(json[0]).toEqual({ siteUrl: 'sc-domain:example.com' });
    expect(json[1]).toEqual({ siteUrl: 'https://www.example.com/' });
  });

  it('returns sc-domain: prefix verbatim — never normalized', async () => {
    mockSitesList.mockResolvedValue({
      data: {
        siteEntry: [
          { siteUrl: 'sc-domain:example.com' },
        ],
      },
    });

    const res = await GET(makeReq());
    const json = await res.json();
    // The sc-domain: prefix must survive unchanged
    expect(json[0].siteUrl).toBe('sc-domain:example.com');
  });

  it('returns 503 when getAuthClient returns {ok: false}', async () => {
    mockGetAuthClient.mockResolvedValue({
      ok: false,
      reason: 'auth',
      message: 'GOOGLE_SA_KEY_FILE env var is not set',
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json).toHaveProperty('error');
    expect(mockSitesList).not.toHaveBeenCalled();
  });

  it('returns 200 [] when siteEntry is absent', async () => {
    mockSitesList.mockResolvedValue({ data: {} });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });
});
