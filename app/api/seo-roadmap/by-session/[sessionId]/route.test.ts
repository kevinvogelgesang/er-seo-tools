import { describe, it, expect, beforeEach, vi } from 'vitest';

const findUniqueMock = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    seoRoadmap: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

import { GET } from './route';
import { NextRequest } from 'next/server';

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/seo-roadmap/by-session/sess_x');
}

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

describe('GET /api/seo-roadmap/by-session/[sessionId]', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
  });

  it('returns null payload when no roadmap exists', async () => {
    findUniqueMock.mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams('sess_missing'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seoRoadmap).toBeNull();
  });

  it('returns shaped object with status and roadmapMarkdown when row exists', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'rm_1',
      sessionId: 'sess_x',
      status: 'complete',
      error: null,
      roadmapMarkdown: '## Roadmap\n\nStep 1: Fix titles.\n',
      roadmapUpdatedAt: new Date('2026-06-01T10:05:00Z'),
      createdAt: new Date('2026-06-01T10:00:00Z'),
      updatedAt: new Date('2026-06-01T10:05:00Z'),
    });
    const res = await GET(makeRequest(), makeParams('sess_x'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seoRoadmap.id).toBe('rm_1');
    expect(body.seoRoadmap.sessionId).toBe('sess_x');
    expect(body.seoRoadmap.status).toBe('complete');
    expect(body.seoRoadmap.error).toBeNull();
    expect(body.seoRoadmap.roadmapMarkdown).toBe('## Roadmap\n\nStep 1: Fix titles.\n');
    expect(body.seoRoadmap.roadmapUpdatedAt).toBe('2026-06-01T10:05:00.000Z');
    expect(body.seoRoadmap.createdAt).toBe('2026-06-01T10:00:00.000Z');
    expect(body.seoRoadmap.updatedAt).toBe('2026-06-01T10:05:00.000Z');
  });

  it('returns null roadmapMarkdown and roadmapUpdatedAt when row is pending', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'rm_2',
      sessionId: 'sess_y',
      status: 'pending',
      error: null,
      roadmapMarkdown: null,
      roadmapUpdatedAt: null,
      createdAt: new Date('2026-06-01T09:00:00Z'),
      updatedAt: new Date('2026-06-01T09:00:00Z'),
    });
    const res = await GET(makeRequest(), makeParams('sess_y'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seoRoadmap.status).toBe('pending');
    expect(body.seoRoadmap.roadmapMarkdown).toBeNull();
    expect(body.seoRoadmap.roadmapUpdatedAt).toBeNull();
  });
});
