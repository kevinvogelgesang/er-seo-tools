import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getClientSeoHistory } from './client-seo-history';

// ── Mock @/lib/db ─────────────────────────────────────────────────────────────
// vi.mock is hoisted to the top of the file, so we must use vi.hoisted()
// to create the mock fns before the factory runs.

const { mockFindUnique, mockFindMany } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    client: { findUnique: mockFindUnique },
    session: { findMany: mockFindMany },
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(id: string, date: Date, overrides: Partial<{
  siteName: string | null;
  siteHost: string | null;
  totalUrls: number | null;
  criticalCount: number | null;
  warningCount: number | null;
  noticeCount: number | null;
}> = {}) {
  return {
    id,
    createdAt: date,
    siteName: overrides.siteName ?? null,
    siteHost: overrides.siteHost ?? null,
    totalUrls: overrides.totalUrls ?? null,
    criticalCount: overrides.criticalCount ?? null,
    warningCount: overrides.warningCount ?? null,
    noticeCount: overrides.noticeCount ?? null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getClientSeoHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null-client shape when client does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);

    const result = await getClientSeoHistory(99);

    expect(result).toEqual({ client: null, sessions: [], latestTwo: null, lastAuditedAt: null });
    // session.findMany should never be called
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('maps Date objects from DB to ISO strings on each session', async () => {
    mockFindUnique.mockResolvedValue({ id: 1, name: 'Acme' });
    const date = new Date('2025-03-15T10:00:00.000Z');
    mockFindMany.mockResolvedValue([makeRow('sess-1', date, { siteName: 'acme.com', siteHost: 'acme.com', totalUrls: 50, criticalCount: 2, warningCount: 5, noticeCount: 10 })]);

    const result = await getClientSeoHistory(1);

    expect(result.sessions).toHaveLength(1);
    expect(typeof result.sessions[0].createdAt).toBe('string');
    expect(result.sessions[0].createdAt).toBe(date.toISOString());
    expect(result.sessions[0]).toMatchObject({
      id: 'sess-1',
      siteName: 'acme.com',
      siteHost: 'acme.com',
      totalUrls: 50,
      criticalCount: 2,
      warningCount: 5,
      noticeCount: 10,
    });
  });

  it('calls session.findMany with correct where/orderBy/select — no result column', async () => {
    mockFindUnique.mockResolvedValue({ id: 7, name: 'Test Client' });
    mockFindMany.mockResolvedValue([]);

    await getClientSeoHistory(7);

    expect(mockFindMany).toHaveBeenCalledOnce();
    const callArg = mockFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      orderBy: Record<string, unknown>;
      select: Record<string, unknown>;
    };

    expect(callArg.where).toEqual({ clientId: 7, status: 'complete' });
    expect(callArg.orderBy).toEqual({ createdAt: 'asc' });

    // Confirm the select includes the expected scalar fields
    expect(callArg.select).toMatchObject({
      id: true,
      createdAt: true,
      siteName: true,
      siteHost: true,
      totalUrls: true,
      criticalCount: true,
      warningCount: true,
      noticeCount: true,
    });

    // Confirm 'result' is NOT in the select
    expect(Object.keys(callArg.select)).not.toContain('result');
  });

  it('returns latestTwo=null when there is only 1 session', async () => {
    mockFindUnique.mockResolvedValue({ id: 2, name: 'Solo Client' });
    mockFindMany.mockResolvedValue([makeRow('only', new Date())]);

    const result = await getClientSeoHistory(2);

    expect(result.latestTwo).toBeNull();
  });

  it('returns latestTwo=[secondLast.id, last.id] when ≥2 sessions', async () => {
    mockFindUnique.mockResolvedValue({ id: 3, name: 'Many Client' });
    const d1 = new Date('2024-01-01T00:00:00Z');
    const d2 = new Date('2024-06-01T00:00:00Z');
    const d3 = new Date('2025-01-01T00:00:00Z');
    mockFindMany.mockResolvedValue([
      makeRow('first', d1),
      makeRow('second', d2),
      makeRow('third', d3),
    ]);

    const result = await getClientSeoHistory(3);

    expect(result.latestTwo).toEqual(['second', 'third']);
  });

  it('returns lastAuditedAt equal to the last session createdAt ISO string', async () => {
    mockFindUnique.mockResolvedValue({ id: 4, name: 'Dated Client' });
    const d1 = new Date('2024-01-01T00:00:00Z');
    const d2 = new Date('2025-12-01T00:00:00Z');
    mockFindMany.mockResolvedValue([makeRow('s1', d1), makeRow('s2', d2)]);

    const result = await getClientSeoHistory(4);

    expect(result.lastAuditedAt).toBe(d2.toISOString());
  });

  it('returns sessions=[] and lastAuditedAt=null when client exists but no complete sessions', async () => {
    mockFindUnique.mockResolvedValue({ id: 5, name: 'Empty Client' });
    mockFindMany.mockResolvedValue([]);

    const result = await getClientSeoHistory(5);

    expect(result.sessions).toEqual([]);
    expect(result.lastAuditedAt).toBeNull();
    expect(result.latestTwo).toBeNull();
    expect(result.client).toEqual({ id: 5, name: 'Empty Client' });
  });
});
