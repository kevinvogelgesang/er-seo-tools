import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── hoist mocks ─────────────────────────────────────────────────────────────
const { mockAccountSummariesList, mockGetAuthClient } = vi.hoisted(() => ({
  mockAccountSummariesList: vi.fn(),
  mockGetAuthClient: vi.fn(),
}));

// ─── mock googleapis ──────────────────────────────────────────────────────────
vi.mock('googleapis', () => {
  const analyticsadminFn = vi.fn().mockReturnValue({
    accountSummaries: { list: mockAccountSummariesList },
  });
  return {
    google: {
      analyticsadmin: analyticsadminFn,
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
  return new NextRequest('http://localhost/api/google/properties');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthClient.mockResolvedValue(MOCK_AUTH);
});

describe('GET /api/google/properties', () => {
  it('returns [{propertyId, displayName}] from accountSummaries.list', async () => {
    mockAccountSummariesList.mockResolvedValue({
      data: {
        accountSummaries: [
          {
            propertySummaries: [
              { property: 'properties/123456', displayName: 'Acme GA4' },
              { property: 'properties/789012', displayName: 'Beta Corp' },
            ],
          },
          {
            propertySummaries: [
              { property: 'properties/345678', displayName: 'Gamma Inc' },
            ],
          },
        ],
      },
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json).toHaveLength(3);
    expect(json[0]).toEqual({ propertyId: 123456, displayName: 'Acme GA4' });
    expect(json[1]).toEqual({ propertyId: 789012, displayName: 'Beta Corp' });
    expect(json[2]).toEqual({ propertyId: 345678, displayName: 'Gamma Inc' });
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
    // Should NOT have called the Google API
    expect(mockAccountSummariesList).not.toHaveBeenCalled();
  });

  it('returns 200 [] when accountSummaries is absent', async () => {
    mockAccountSummariesList.mockResolvedValue({ data: {} });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });
});
