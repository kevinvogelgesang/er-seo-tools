// A3 Task 2: characterization tests for POST /api/diff — pins CURRENT
// behavior against real Session/CrawlRun fixtures (DB-backed, house style A).
// Note: unlike brief/[sessionId] and brief/live, this route's outer catch
// does NOT leak error.message (`{ error: 'Internal server error' }`) — the
// case table for this route does not ask us to pin a leak, and there isn't
// one to pin.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { POST } from './route';

const PREFIX = '__a3diff__';

const BLOB = JSON.stringify({
  crawl_summary: {
    total_urls: 1,
    indexable_urls: 1,
    ok_responses: 1,
    client_errors: 0,
    server_errors: 0,
    avg_word_count: 100,
  },
  issues: { critical: [], warnings: [], notices: [] },
  metadata: {},
});

async function clear() {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } });
  await prisma.session.deleteMany({ where: { siteName: { startsWith: PREFIX } } });
}
beforeEach(clear);
afterAll(clear);

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/diff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
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

describe('POST /api/diff', () => {
  it('400 invalid_json on malformed body', async () => {
    const res = await POST(req('{not json'));
    expect(res.status).toBe(400);
    // A3: normalized from "Invalid JSON body"
    expect((await res.json()).error).toBe('invalid_json');
  });

  it('400 Invalid sessionAId for a malformed id', async () => {
    const b = await makeSession('b1');
    const res = await POST(req({ sessionAId: 'not-a-uuid', sessionBId: b }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid sessionAId');
  });

  it('400 Invalid sessionBId for a malformed id', async () => {
    const a = await makeSession('a1');
    const res = await POST(req({ sessionAId: a, sessionBId: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid sessionBId');
  });

  it('404 Session A not found for a well-formed but unknown id', async () => {
    const b = await makeSession('b2');
    const res = await POST(req({ sessionAId: randomUUID(), sessionBId: b }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Session A not found');
  });

  it('404 Session B not found for a well-formed but unknown id', async () => {
    const a = await makeSession('a2');
    const res = await POST(req({ sessionAId: a, sessionBId: randomUUID() }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Session B not found');
  });

  it('400 when Session A is not complete', async () => {
    const a = await makeSession('a3', { status: 'parsing' });
    const b = await makeSession('b3');
    const res = await POST(req({ sessionAId: a, sessionBId: b }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Session A is not complete (status: parsing)');
  });

  it('400 when Session B is not complete', async () => {
    const a = await makeSession('a4');
    const b = await makeSession('b4', { status: 'pending' });
    const res = await POST(req({ sessionAId: a, sessionBId: b }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Session B is not complete (status: pending)');
  });

  it('409 session_archived when a side has been blob-pruned', async () => {
    const a = await makeSession('a5');
    const b = await makeSession('b5', { result: null });
    await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser',
        source: 'sf-upload',
        domain: `${PREFIX}archived.example.com`,
        sessionId: b,
        status: 'complete',
        pagesTotal: 0,
        archivePrunedAt: new Date(),
      },
    });
    const res = await POST(req({ sessionAId: a, sessionBId: b }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('session_archived');
  });

  it('200 diffs two complete, unpruned sessions', async () => {
    const a = await makeSession('a6');
    const b = await makeSession('b6');
    const res = await POST(req({ sessionAId: a, sessionBId: b }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session_a.id).toBe(a);
    expect(body.session_b.id).toBe(b);
  });
});
