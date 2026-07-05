// A3 Task 2: characterization tests for POST /api/brief/[sessionId] — pins
// CURRENT behavior, warts included. Two deliberate defects are pinned here:
//   1. A malformed JSON request body silently defaults to `{}` (caught by
//      `.catch(() => ({}))`), which then fails the clientName check with the
//      SAME 400 as an omitted clientName.
//   2. The outer catch leaks `error.message` straight into the response body
//      (`{ error: message }`, status 500) — Task 12 fixes this; do not "fix"
//      the route here.
// The full upload-parse success path is skipped (needs a real multi-file SF
// export fixture) — validation + error branches are covered instead.
// Session lookups use the real DB (house style A); `fs/promises` is mocked
// per the plan's guidance (a real on-disk fixture would need UPLOADS_DIR to
// point somewhere writable, which it does not in this test environment —
// importing the route pulls in Next's env loader, which in test mode loads
// only `.env` and skips `.env.local`, resolving UPLOADS_DIR to the
// non-writable prod path `/var/lib/er-seo-tools/uploads`).
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';

const accessMock = vi.fn();
const readFileMock = vi.fn();
vi.mock('fs/promises', () => ({
  default: {
    access: (...args: unknown[]) => accessMock(...args),
    readFile: (...args: unknown[]) => readFileMock(...args),
  },
}));

import { POST } from './route'; // import AFTER the mock

const PREFIX = '__a3brief__';

function params(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/brief/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function clear() {
  await prisma.session.deleteMany({ where: { siteName: { startsWith: PREFIX } } });
}
beforeEach(async () => {
  await clear();
  accessMock.mockReset().mockRejectedValue(new Error('ENOENT'));
  readFileMock.mockReset();
});
afterAll(clear);

describe('POST /api/brief/[sessionId]', () => {
  it('400 Invalid session ID for a malformed sessionId (checked before clientName)', async () => {
    const res = await POST(req({ clientName: 'Acme' }), params('not-a-uuid'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid session ID');
  });

  it('400 Client name is required when clientName is absent', async () => {
    const res = await POST(req({}), params(randomUUID()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Client name is required');
  });

  it('400 Client name is required when clientName is whitespace-only', async () => {
    const res = await POST(req({ clientName: '   ' }), params(randomUUID()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Client name is required');
  });

  it('pins: malformed JSON body defaults to {} -> 400 Client name is required', async () => {
    const res = await POST(req('{not json'), params(randomUUID()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Client name is required');
  });

  it('404 Session not found for a well-formed but unknown sessionId', async () => {
    const res = await POST(req({ clientName: 'Acme' }), params(randomUUID()));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Session not found');
  });

  it('pins: outer-catch 500 leaks error.message when a session file cannot be read', async () => {
    const sessionId = randomUUID();
    await prisma.session.create({
      data: {
        id: sessionId,
        siteName: `${PREFIX}leak`,
        files: JSON.stringify(['report.csv']),
        status: 'complete',
        workflow: 'technical',
      },
    });

    // fs.access() (wrapped, skip-on-fail) succeeds, but the subsequent
    // fs.readFile() is NOT wrapped in the route and throws — that error
    // propagates unmodified to the outer catch and its message is echoed
    // straight into the JSON response.
    accessMock.mockResolvedValue(undefined);
    readFileMock.mockRejectedValue(new Error('EISDIR: illegal operation on a directory, read'));

    const res = await POST(req({ clientName: 'Acme' }), params(sessionId));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('EISDIR: illegal operation on a directory, read');
  });
});
