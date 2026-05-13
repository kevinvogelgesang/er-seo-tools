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

const ORIG_ENV = { ...process.env };

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
    process.env = { ...ORIG_ENV };
    vi.useRealTimers();
    adaFindUniqueMock.mockReset();
    adaUpdateMock.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates an expiring ADA share token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T12:00:00Z'));
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('share-token' as `${string}-${string}-${string}-${string}-${string}`);
    process.env.NEXT_PUBLIC_APP_URL = 'https://public.example.com';

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
      shareUrl: 'https://public.example.com/ada-audit/share/share-token',
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

  it('does not use the request Origin header when the public app URL is unset', async () => {
    adaFindUniqueMock.mockResolvedValue({
      shareToken: 'share-token',
      shareExpiresAt: new Date('2099-01-01T00:00:00Z'),
    });

    const res = await GET(makeRequest(), makeParams('audit-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.shareUrl).toBe('http://localhost:3000/ada-audit/share/share-token');
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
