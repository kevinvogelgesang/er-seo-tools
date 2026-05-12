import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adaFindUniqueMock = vi.fn();
const adaUpdateMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    adaAudit: {
      findUnique: (...args: unknown[]) => adaFindUniqueMock(...args),
      update: (...args: unknown[]) => adaUpdateMock(...args),
    },
  },
}));

import { GET, POST } from './route';

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/ada-audit/audit-1/share', {
    method: 'POST',
    headers: { origin: 'https://app.example.com' },
  });
}

describe('/api/ada-audit/[id]/share', () => {
  beforeEach(() => {
    vi.useRealTimers();
    adaFindUniqueMock.mockReset();
    adaUpdateMock.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates an expiring ADA share token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T12:00:00Z'));
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('share-token' as `${string}-${string}-${string}-${string}-${string}`);

    adaFindUniqueMock.mockResolvedValue({
      id: 'audit-1',
      status: 'complete',
      shareToken: null,
      shareExpiresAt: null,
    });

    const res = await POST(makeRequest(), makeParams('audit-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shareUrl: 'https://app.example.com/ada-audit/share/share-token',
      expiresAt: '2026-06-11T12:00:00.000Z',
    });
    expect(adaUpdateMock).toHaveBeenCalledWith({
      where: { id: 'audit-1' },
      data: {
        shareToken: 'share-token',
        shareExpiresAt: new Date('2026-06-11T12:00:00.000Z'),
      },
    });
  });

  it('hides expired existing ADA share tokens', async () => {
    adaFindUniqueMock.mockResolvedValue({
      shareToken: 'expired-token',
      shareExpiresAt: new Date('2000-01-01T00:00:00Z'),
    });

    const res = await GET(makeRequest(), makeParams('audit-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ shareToken: null });
  });
});
