// A3 Task 2: characterization tests for POST /api/brief/live — pins CURRENT
// behavior. The canonical-run lookup (`buildBriefFromCanonical`) is mocked
// (a real fixture would need a full CrawlPage-backed canonical run); the
// outer-catch `{ error: error.message }` 500 leak is deliberately pinned
// here — Task 12 fixes it, not this test.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const buildBriefFromCanonicalMock = vi.fn();
vi.mock('@/lib/services/brief-from-canonical', () => ({
  buildBriefFromCanonical: (...args: unknown[]) => buildBriefFromCanonicalMock(...args),
}));

import { POST } from './route'; // import AFTER the mock

// Block body deliberately: an implicit-return arrow here (`() =>
// mock.mockReset()`) hands the hook runner the mock's return value, which
// misattributes an unrelated rejection to whichever test runs next under
// this Vitest/Node combination — block body avoids returning anything.
beforeEach(() => {
  buildBriefFromCanonicalMock.mockReset();
});

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/brief/live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/brief/live', () => {
  it('400 Invalid JSON body on malformed JSON', async () => {
    const res = await POST(req('{not json'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid JSON body');
    expect(buildBriefFromCanonicalMock).not.toHaveBeenCalled();
  });

  it('400 Request body must be an object for null/string/number bodies', async () => {
    for (const raw of ['null', '"just a string"', '42']) {
      const res = await POST(req(raw));
      expect(res.status, raw).toBe(400);
      expect((await res.json()).error).toBe('Request body must be an object');
    }
  });

  it('400 clientId must be a positive integer', async () => {
    for (const clientId of [0, -1, 1.5, 'abc']) {
      const res = await POST(req({ clientId, domain: 'example.com' }));
      expect(res.status, JSON.stringify(clientId)).toBe(400);
      expect((await res.json()).error).toBe('clientId must be a positive integer');
    }
    // omitted entirely
    const res = await POST(req({ domain: 'example.com' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('clientId must be a positive integer');
  });

  it('400 domain must be a non-empty string', async () => {
    for (const domain of ['', '   ', 123]) {
      const res = await POST(req({ clientId: 1, domain }));
      expect(res.status, JSON.stringify(domain)).toBe(400);
      expect((await res.json()).error).toBe('domain must be a non-empty string');
    }
    // omitted entirely
    const res = await POST(req({ clientId: 1 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('domain must be a non-empty string');
  });

  it('404 when no canonical run is found for the client+domain', async () => {
    buildBriefFromCanonicalMock.mockResolvedValue(null);
    const res = await POST(req({ clientId: 1, domain: 'example.com' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('No canonical SEO run found for this client and domain');
    expect(buildBriefFromCanonicalMock).toHaveBeenCalledWith({ clientId: 1, domain: 'example.com' });
  });

  it('200 returns brief + stats on success (domain is trimmed)', async () => {
    buildBriefFromCanonicalMock.mockResolvedValue({ brief: '# Brief', stats: { pages: 1 } });
    const res = await POST(req({ clientId: 1, domain: '  example.com  ' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ brief: '# Brief', stats: { pages: 1 } });
    expect(buildBriefFromCanonicalMock).toHaveBeenCalledWith({ clientId: 1, domain: 'example.com' });
  });

  it('pins: outer-catch 500 leaks error.message', async () => {
    buildBriefFromCanonicalMock.mockRejectedValue(new Error('boom'));
    const res = await POST(req({ clientId: 1, domain: 'example.com' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('boom');
  });
});
