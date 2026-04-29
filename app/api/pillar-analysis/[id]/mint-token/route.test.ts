import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock prisma so we don't need a DB. We mock @/lib/db at the module-import level.
const findUniqueMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    pillarAnalysis: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

import { POST } from './route';
import { NextRequest } from 'next/server';

const ORIG_ENV = { ...process.env };

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/pillar-analysis/test/mint-token', {
    method: 'POST',
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/pillar-analysis/[id]/mint-token', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    process.env = { ...ORIG_ENV, PILLAR_TOKEN_SECRET: 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaa', NODE_ENV: 'test' };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('404 when analysis not found', async () => {
    findUniqueMock.mockResolvedValue(null);
    const res = await POST(makeRequest(), makeParams('pa_missing'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not_found');
  });

  it('409 when analysis is not complete', async () => {
    findUniqueMock.mockResolvedValue({ id: 'pa_running', status: 'running' });
    const res = await POST(makeRequest(), makeParams('pa_running'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('not_complete');
    expect(body.status).toBe('running');
  });

  it('200 with token + expiresAt on success', async () => {
    findUniqueMock.mockResolvedValue({ id: 'pa_complete', status: 'complete' });
    const res = await POST(makeRequest(), makeParams('pa_complete'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toMatch(/^pat_/);
    expect(typeof body.expiresAt).toBe('string');
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});
