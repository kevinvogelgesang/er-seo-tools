// Task 17: client analytics mapping API — DB-backed tests
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { GET, PATCH } from './route';

const PREFIX = '__t17anlytx__';

function routeParams(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

function jsonReq(method: string, body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/clients/1/analytics', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function makeClient(tag: string, overrides?: {
  ga4PropertyId?: string;
  gscSiteUrl?: string;
  crmClientRef?: string;
}) {
  return prisma.client.create({
    data: {
      name: `${PREFIX}${tag}`,
      ...(overrides ?? {}),
    },
  });
}

async function clear() {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

beforeEach(clear);
afterAll(clear);

describe('GET /api/clients/:id/analytics', () => {
  it('returns the three mapping fields for an existing client', async () => {
    const c = await makeClient('get1', {
      ga4PropertyId: '123456789',
      gscSiteUrl: 'sc-domain:example.com',
      crmClientRef: 'crm-ref-001',
    });

    const res = await GET(new NextRequest('http://localhost/api/clients/1/analytics'), routeParams(c.id));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ga4PropertyId).toBe('123456789');
    expect(json.gscSiteUrl).toBe('sc-domain:example.com');
    expect(json.crmClientRef).toBe('crm-ref-001');
  });

  it('returns null fields for an unmapped client', async () => {
    const c = await makeClient('get2');

    const res = await GET(new NextRequest('http://localhost/api/clients/1/analytics'), routeParams(c.id));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ga4PropertyId).toBeNull();
    expect(json.gscSiteUrl).toBeNull();
    expect(json.crmClientRef).toBeNull();
  });

  it('returns 404 for an unknown client', async () => {
    const res = await GET(new NextRequest('http://localhost/api/clients/1/analytics'), routeParams(99999999));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/clients/:id/analytics', () => {
  it('persists all three mapping fields', async () => {
    const c = await makeClient('patch1');

    const res = await PATCH(jsonReq('PATCH', {
      ga4PropertyId: '987654321',
      gscSiteUrl: 'https://www.example.com/',
      crmClientRef: 'crm-abc',
    }), routeParams(c.id));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ga4PropertyId).toBe('987654321');
    expect(json.gscSiteUrl).toBe('https://www.example.com/');
    expect(json.crmClientRef).toBe('crm-abc');

    // Verify persisted to DB
    const dbRow = await prisma.client.findUnique({ where: { id: c.id } });
    expect(dbRow!.ga4PropertyId).toBe('987654321');
    expect(dbRow!.gscSiteUrl).toBe('https://www.example.com/');
    expect(dbRow!.crmClientRef).toBe('crm-abc');
  });

  it('stores gscSiteUrl verbatim — sc-domain: prefix never normalized', async () => {
    const c = await makeClient('patch2');

    const res = await PATCH(jsonReq('PATCH', {
      gscSiteUrl: 'sc-domain:example.com',
    }), routeParams(c.id));

    expect(res.status).toBe(200);
    const json = await res.json();
    // Verbatim — must not be converted to https:// or normalized in any way
    expect(json.gscSiteUrl).toBe('sc-domain:example.com');

    // Double-check at the DB layer
    const dbRow = await prisma.client.findUnique({ where: { id: c.id } });
    expect(dbRow!.gscSiteUrl).toBe('sc-domain:example.com');
  });

  it('clears fields when patched with null', async () => {
    const c = await makeClient('patch3', {
      ga4PropertyId: '111',
      gscSiteUrl: 'sc-domain:test.com',
      crmClientRef: 'ref1',
    });

    const res = await PATCH(jsonReq('PATCH', {
      ga4PropertyId: null,
      gscSiteUrl: null,
      crmClientRef: null,
    }), routeParams(c.id));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ga4PropertyId).toBeNull();
    expect(json.gscSiteUrl).toBeNull();
    expect(json.crmClientRef).toBeNull();
  });

  it('returns 404 for an unknown client', async () => {
    const res = await PATCH(jsonReq('PATCH', { ga4PropertyId: '123' }), routeParams(99999999));
    expect(res.status).toBe(404);
  });

  it('returns 400 when a field value is an invalid type', async () => {
    const c = await makeClient('patch5');

    const res = await PATCH(jsonReq('PATCH', { ga4PropertyId: 12345 }), routeParams(c.id));
    expect(res.status).toBe(400);
  });

  it('returns 400 when no valid fields are provided', async () => {
    const c = await makeClient('patch6');

    const res = await PATCH(jsonReq('PATCH', {}), routeParams(c.id));
    expect(res.status).toBe(400);
  });
});
