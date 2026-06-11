import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { GET } from './route';
import { NextRequest } from 'next/server';

// Real-DB coverage for the flipped reader: the mock tests can't prove Prisma 5
// on SQLite accepts orderBy { findings: { _count } } combined with skip/take,
// the findings.some filter, and the unnarrowed include. One seeded run does.

const SESSION_ID = randomUUID();
const TEST_DOMAIN = 'pages-route-db-test.example';

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

async function clearTestState() {
  await prisma.crawlRun.deleteMany({
    where: { OR: [{ sessionId: SESSION_ID }, { domain: TEST_DOMAIN }] },
  });
  await prisma.session.deleteMany({ where: { id: SESSION_ID } });
}

beforeAll(async () => {
  await clearTestState();
  await prisma.session.create({
    data: { id: SESSION_ID, files: '[]', status: 'complete' },
  });
  const runId = randomUUID();
  await prisma.crawlRun.create({
    data: {
      id: runId,
      tool: 'seo-parser',
      source: 'sf-upload',
      domain: TEST_DOMAIN,
      sessionId: SESSION_ID,
      status: 'complete',
      pagesTotal: 2,
    },
  });
  const busyId = randomUUID();
  const quietId = randomUUID();
  await prisma.crawlPage.createMany({
    data: [
      { id: busyId, runId, url: `https://${TEST_DOMAIN}/busy`, title: 'Busy', indexable: true, wordCount: 100 },
      { id: quietId, runId, url: `https://${TEST_DOMAIN}/quiet`, title: 'Quiet', indexable: true, wordCount: 900 },
    ],
  });
  await prisma.finding.createMany({
    data: [
      { id: randomUUID(), runId, pageId: busyId, scope: 'page', type: 'missing_title', severity: 'critical', url: `https://${TEST_DOMAIN}/busy`, dedupKey: 'pages-db-k1' },
      { id: randomUUID(), runId, pageId: busyId, scope: 'page', type: 'thin_content', severity: 'warning', url: `https://${TEST_DOMAIN}/busy`, dedupKey: 'pages-db-k2' },
      { id: randomUUID(), runId, pageId: quietId, scope: 'page', type: 'temporary_redirects', severity: 'notice', url: `https://${TEST_DOMAIN}/quiet`, dedupKey: 'pages-db-k3' },
      // run-scope row with NULL pageId must not join to any page
      { id: randomUUID(), runId, pageId: null, scope: 'run', type: 'missing_title', severity: 'critical', dedupKey: 'pages-db-k4' },
    ],
  });
});

afterAll(clearTestState);

describe('pages route against the real DB (CrawlRun-backed)', () => {
  it('orders by findings count desc with url tiebreaker and shapes the response', async () => {
    const res = await GET(
      new NextRequest(`http://t/api/seo-parser/${SESSION_ID}/pages`),
      makeParams(SESSION_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.pages.map((p: { url: string }) => p.url)).toEqual([
      `https://${TEST_DOMAIN}/busy`,
      `https://${TEST_DOMAIN}/quiet`,
    ]);
    expect(body.pages[0]).toMatchObject({
      sessionId: SESSION_ID,
      issueTypes: ['missing_title', 'thin_content'],
      issueCount: 2,
      indexable: true,
    });
  });

  it('filters via findings.some without narrowing issueTypes', async () => {
    const res = await GET(
      new NextRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?issueType=thin_content`),
      makeParams(SESSION_ID),
    );
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.pages[0].url).toBe(`https://${TEST_DOMAIN}/busy`);
    expect(body.pages[0].issueTypes).toEqual(['missing_title', 'thin_content']);
  });

  it('sort=wordCount orders ascending', async () => {
    const res = await GET(
      new NextRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?sort=wordCount`),
      makeParams(SESSION_ID),
    );
    const body = await res.json();
    expect(body.pages.map((p: { wordCount: number }) => p.wordCount)).toEqual([100, 900]);
  });

  it('paginates with skip/take under the relation-count orderBy', async () => {
    const res = await GET(
      new NextRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?limit=1&offset=1`),
      makeParams(SESSION_ID),
    );
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0].url).toBe(`https://${TEST_DOMAIN}/quiet`);
  });
});
