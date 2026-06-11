import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionPageFindManyMock = vi.fn();
const sessionPageCountMock = vi.fn();
const crawlRunFindUniqueMock = vi.fn();
const crawlPageFindManyMock = vi.fn();
const crawlPageCountMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    sessionPage: {
      findMany: (...args: unknown[]) => sessionPageFindManyMock(...args),
      count: (...args: unknown[]) => sessionPageCountMock(...args),
    },
    crawlRun: {
      findUnique: (...args: unknown[]) => crawlRunFindUniqueMock(...args),
    },
    crawlPage: {
      findMany: (...args: unknown[]) => crawlPageFindManyMock(...args),
      count: (...args: unknown[]) => crawlPageCountMock(...args),
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
const RUN_ID = 'run-1';

const legacyRow = {
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

const crawlRow = {
  id: 'cp_1',
  runId: RUN_ID,
  url: 'https://example.com/page',
  status: null,
  error: null,
  finalUrl: null,
  statusCode: null,
  title: 'Test Page',
  h1: 'Test H1',
  metaDescription: 'A test page',
  wordCount: 300,
  crawlDepth: 1,
  indexable: true,
  score: null,
  adaAuditId: null,
  findings: [
    { type: 'thin_content', severity: 'warning' },
    { type: 'missing_title', severity: 'critical' },
    { type: 'broken_pages', severity: 'critical' },
  ],
};

describe('GET /api/seo-parser/[sessionId]/pages — CrawlRun-backed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crawlRunFindUniqueMock.mockResolvedValue({ id: RUN_ID });
    crawlPageFindManyMock.mockResolvedValue([crawlRow]);
    crawlPageCountMock.mockResolvedValue(1);
  });

  it('queries CrawlPage by runId with findings include and identical response shape', async () => {
    const res = await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages`),
      makeParams(SESSION_ID),
    );
    expect(res.status).toBe(200);
    expect(crawlRunFindUniqueMock).toHaveBeenCalledWith({
      where: { sessionId: SESSION_ID },
      select: { id: true },
    });
    expect(crawlPageFindManyMock).toHaveBeenCalledWith({
      where: { runId: RUN_ID },
      orderBy: [{ findings: { _count: 'desc' } }, { url: 'asc' }],
      take: 50,
      skip: 0,
      include: { findings: { select: { type: true, severity: true } } },
    });
    expect(sessionPageFindManyMock).not.toHaveBeenCalled();

    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.pages).toEqual([
      {
        id: 'cp_1',
        sessionId: SESSION_ID,
        url: 'https://example.com/page',
        title: 'Test Page',
        h1: 'Test H1',
        metaDescription: 'A test page',
        wordCount: 300,
        crawlDepth: 1,
        indexable: true,
        // severity rank (critical < warning < notice), then type asc
        issueTypes: ['broken_pages', 'missing_title', 'thin_content'],
        issueCount: 3,
      },
    ]);
  });

  it('filters by issueType via findings.some without narrowing the included findings', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?issueType=broken_pages`),
      makeParams(SESSION_ID),
    );
    expect(crawlPageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: RUN_ID, findings: { some: { type: 'broken_pages' } } },
        include: { findings: { select: { type: true, severity: true } } },
      }),
    );
    expect(crawlPageCountMock).toHaveBeenCalledWith({
      where: { runId: RUN_ID, findings: { some: { type: 'broken_pages' } } },
    });
  });

  it('sort=wordCount / sort=crawlDepth use scalar orderBy with url tiebreaker', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?sort=wordCount`),
      makeParams(SESSION_ID),
    );
    expect(crawlPageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ wordCount: 'asc' }, { url: 'asc' }] }),
    );
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?sort=crawlDepth`),
      makeParams(SESSION_ID),
    );
    expect(crawlPageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ crawlDepth: 'desc' }, { url: 'asc' }] }),
    );
  });

  it('coalesces null indexable to true and handles zero findings', async () => {
    crawlPageFindManyMock.mockResolvedValue([{ ...crawlRow, indexable: null, findings: [] }]);
    const res = await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages`),
      makeParams(SESSION_ID),
    );
    const body = await res.json();
    expect(body.pages[0].indexable).toBe(true);
    expect(body.pages[0].issueTypes).toEqual([]);
    expect(body.pages[0].issueCount).toBe(0);
  });

  it('clamps limit and passes offset (CrawlRun path)', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?limit=9999&offset=5`),
      makeParams(SESSION_ID),
    );
    expect(crawlPageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200, skip: 5 }),
    );
  });
});

describe('GET /api/seo-parser/[sessionId]/pages — legacy SessionPage fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crawlRunFindUniqueMock.mockResolvedValue(null);
    sessionPageFindManyMock.mockResolvedValue([legacyRow]);
    sessionPageCountMock.mockResolvedValue(1);
  });

  it('uses defaults: take=50, skip=0, orderBy issueCount desc + url tiebreaker, no issueType filter', async () => {
    const res = await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages`),
      makeParams(SESSION_ID),
    );
    expect(res.status).toBe(200);
    expect(sessionPageFindManyMock).toHaveBeenCalledWith({
      where: { sessionId: SESSION_ID },
      orderBy: [{ issueCount: 'desc' }, { url: 'asc' }],
      take: 50,
      skip: 0,
    });
    expect(crawlPageFindManyMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.pages[0].issueTypes).toEqual(['missing_title']);
  });

  it('passes quoted issueType to where.issueTypes.contains', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?issueType=missing_title`),
      makeParams(SESSION_ID),
    );
    const callWhere = sessionPageFindManyMock.mock.calls[0][0].where;
    expect(callWhere.issueTypes.contains).toBe('"missing_title"');
  });

  it('sort variants map to SessionPage orderBy', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?sort=wordCount`),
      makeParams(SESSION_ID),
    );
    expect(sessionPageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ wordCount: 'asc' }, { url: 'asc' }] }),
    );
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?sort=crawlDepth`),
      makeParams(SESSION_ID),
    );
    expect(sessionPageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ crawlDepth: 'desc' }, { url: 'asc' }] }),
    );
  });

  it('clamps limit=9999 to 200 and falls back to 50 on garbage', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?limit=9999`),
      makeParams(SESSION_ID),
    );
    expect(sessionPageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?limit=abc`),
      makeParams(SESSION_ID),
    );
    expect(sessionPageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });

  it('passes offset to skip', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?limit=10&offset=5`),
      makeParams(SESSION_ID),
    );
    expect(sessionPageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 5 }),
    );
  });

  it('returns [] for malformed issueTypes JSON and non-array JSON', async () => {
    sessionPageFindManyMock.mockResolvedValue([
      { ...legacyRow, issueTypes: 'not-json{{' },
      { ...legacyRow, id: 'page_2', url: 'https://example.com/2', issueTypes: '{"key":"val"}' },
    ]);
    const res = await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages`),
      makeParams(SESSION_ID),
    );
    const body = await res.json();
    expect(body.pages[0].issueTypes).toEqual([]);
    expect(body.pages[1].issueTypes).toEqual([]);
  });
});
