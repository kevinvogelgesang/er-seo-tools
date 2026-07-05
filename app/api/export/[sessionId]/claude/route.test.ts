// A3 Task 3: characterization tests for GET /api/export/[sessionId]/claude.
// Streaming route (exemplar C) — assert via res.text() + Content-Disposition /
// Content-Type headers, NEVER res.json() on the stream body itself.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { GET } from './route';

const PREFIX = '__a3expc__';

const BLOB = JSON.stringify({
  crawl_summary: { total_urls: 3, indexable_urls: 3, ok_responses: 3 },
  issues: {
    critical: [{ type: 'missing_title', severity: 'critical', count: 1, description: 'Missing title tag' }],
    warnings: [],
    notices: [],
  },
  site_structure: {},
  resources: {},
  technical_seo: {},
  performance: {},
  recommendations: ['Fix missing titles'],
  metadata: { files_processed: ['internal_all.csv'], parsers_used: ['TitleParser'], total_parsers_available: 5 },
});

async function clear() {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } });
  await prisma.session.deleteMany({ where: { siteName: { startsWith: PREFIX } } });
}
beforeEach(clear);
afterAll(clear);

const params = (sessionId: string) => ({ params: Promise.resolve({ sessionId }) });

function req(): NextRequest {
  return new NextRequest('http://localhost/api/export/x/claude');
}

async function makeSession(tag: string, opts: { status?: string; result?: string | null } = {}): Promise<string> {
  const id = randomUUID();
  await prisma.session.create({
    data: {
      id,
      siteName: `${PREFIX}${tag}`,
      files: '[]',
      status: opts.status ?? 'complete',
      result: opts.result === undefined ? BLOB : opts.result,
      workflow: 'technical',
    },
  });
  return id;
}

describe('GET /api/export/[sessionId]/claude', () => {
  it('400 Invalid session ID for a malformed sessionId', async () => {
    const res = await GET(req(), params('not-a-uuid'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid session ID');
  });

  it('404 Session not found for a well-formed but unknown sessionId', async () => {
    const res = await GET(req(), params(randomUUID()));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Session not found');
  });

  it("400 'Parsing not complete' when the session status isn't complete", async () => {
    const id = await makeSession('pending', { status: 'pending' });
    const res = await GET(req(), params(id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Parsing not complete');
  });

  it('409 session_archived when the result blob was pruned', async () => {
    const id = await makeSession('archived', { result: null });
    await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser',
        source: 'sf-upload',
        domain: `${PREFIX}archived.example.com`,
        sessionId: id,
        status: 'complete',
        pagesTotal: 0,
        archivePrunedAt: new Date(),
      },
    });
    const res = await GET(req(), params(id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('session_archived');
  });

  it('200 streams a claude export with attachment headers', async () => {
    const id = await makeSession('claude1');
    const res = await GET(req(), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    expect(res.headers.get('Content-Disposition')).toContain(`technical-audit-claude-${id.slice(0, 8)}.json`);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
    const body = JSON.parse(text);
    expect(body.crawl_summary.total_urls).toBe(3);
  });
});
