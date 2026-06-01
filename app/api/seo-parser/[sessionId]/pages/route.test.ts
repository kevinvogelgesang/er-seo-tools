import { describe, it, expect, beforeEach, vi } from 'vitest';

const findManyMock = vi.fn();
const countMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    sessionPage: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

import { GET } from './route';
import { NextRequest } from 'next/server';

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

function makeRequest(url: string) {
  return new NextRequest(url);
}

const SESSION_ID = 's1';

const baseRow = {
  id: 'page_1',
  sessionId: SESSION_ID,
  url: 'https://example.com/page',
  title: 'Test Page',
  h1: 'Test H1',
  metaDescription: 'A test page',
  wordCount: 300,
  crawlDepth: 1,
  indexable: true,
  issueTypes: '["missing_title"]',
  issueCount: 1,
};

describe('GET /api/seo-parser/[sessionId]/pages', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    countMock.mockReset();
    findManyMock.mockResolvedValue([baseRow]);
    countMock.mockResolvedValue(1);
  });

  // ─── Default params ──────────────────────────────────────────────────────
  it('uses defaults: take=50, skip=0, orderBy issueCount desc, no issueType filter', async () => {
    const res = await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages`),
      makeParams(SESSION_ID),
    );
    expect(res.status).toBe(200);

    expect(findManyMock).toHaveBeenCalledWith({
      where: { sessionId: SESSION_ID },
      orderBy: { issueCount: 'desc' },
      take: 50,
      skip: 0,
    });
    expect(countMock).toHaveBeenCalledWith({ where: { sessionId: SESSION_ID } });

    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.pages).toHaveLength(1);
    // issueTypes should be a parsed array, not a raw string
    expect(body.pages[0].issueTypes).toEqual(['missing_title']);
  });

  // ─── issueTypes deserialization ──────────────────────────────────────────
  it('parses issueTypes JSON string into an array', async () => {
    findManyMock.mockResolvedValue([{ ...baseRow, issueTypes: '["missing_title","missing_h1"]' }]);
    const res = await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages`),
      makeParams(SESSION_ID),
    );
    const body = await res.json();
    expect(body.pages[0].issueTypes).toEqual(['missing_title', 'missing_h1']);
  });

  // ─── Limit clamping ──────────────────────────────────────────────────────
  it('clamps limit=9999 to 200', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?limit=9999`),
      makeParams(SESSION_ID),
    );
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });

  it('falls back to 50 when limit=0', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?limit=0`),
      makeParams(SESSION_ID),
    );
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });

  it('falls back to 50 when limit is garbage', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?limit=abc`),
      makeParams(SESSION_ID),
    );
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });

  // ─── issueType filter ────────────────────────────────────────────────────
  it('passes quoted issueType to where.issueTypes.contains', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?issueType=missing_title`),
      makeParams(SESSION_ID),
    );
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sessionId: SESSION_ID,
          issueTypes: { contains: JSON.stringify('missing_title') },
        },
      }),
    );
    // Confirm the exact quoted form
    const callWhere = findManyMock.mock.calls[0][0].where;
    expect(callWhere.issueTypes.contains).toBe('"missing_title"');
  });

  // ─── sort variants ───────────────────────────────────────────────────────
  it('sort=wordCount → orderBy { wordCount: "asc" }', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?sort=wordCount`),
      makeParams(SESSION_ID),
    );
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { wordCount: 'asc' } }),
    );
  });

  it('sort=crawlDepth → orderBy { crawlDepth: "desc" }', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?sort=crawlDepth`),
      makeParams(SESSION_ID),
    );
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { crawlDepth: 'desc' } }),
    );
  });

  it('default sort → orderBy { issueCount: "desc" }', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?sort=issues`),
      makeParams(SESSION_ID),
    );
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { issueCount: 'desc' } }),
    );
  });

  // ─── offset ──────────────────────────────────────────────────────────────
  it('passes offset to skip', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?limit=10&offset=5`),
      makeParams(SESSION_ID),
    );
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 5 }),
    );
  });

  // ─── safeParse: malformed JSON ───────────────────────────────────────────
  it('returns [] for a row with malformed issueTypes JSON', async () => {
    findManyMock.mockResolvedValue([{ ...baseRow, issueTypes: 'not-json{{' }]);
    const res = await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages`),
      makeParams(SESSION_ID),
    );
    const body = await res.json();
    expect(body.pages[0].issueTypes).toEqual([]);
  });

  it('returns [] when issueTypes parses to a non-array (e.g. object)', async () => {
    findManyMock.mockResolvedValue([{ ...baseRow, issueTypes: '{"key":"val"}' }]);
    const res = await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages`),
      makeParams(SESSION_ID),
    );
    const body = await res.json();
    expect(body.pages[0].issueTypes).toEqual([]);
  });
});
