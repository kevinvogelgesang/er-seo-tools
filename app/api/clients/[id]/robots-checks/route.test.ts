// app/api/clients/[id]/robots-checks/route.test.ts
//
// D4 route tests. Service is mocked for POST behavior; validation paths are
// exercised against the real DB (PREFIX clients). Auth is middleware-level
// (cookie gate), NOT tested here — the route lives under /api/clients/.
import { describe, it, expect, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

vi.mock('@/lib/robots-check/service', () => ({
  runAndStoreRobotsCheck: vi.fn(),
  listRobotsChecks: vi.fn().mockResolvedValue([]),
  getRobotsCheck: vi.fn(),
}))
import { runAndStoreRobotsCheck, getRobotsCheck } from '@/lib/robots-check/service'
import { GET, POST } from './route'
import { GET as GET_DETAIL } from './[checkId]/route'

const mockRun = vi.mocked(runAndStoreRobotsCheck)
const mockGet = vi.mocked(getRobotsCheck)
const PREFIX = 'd4route-'
let counter = 0

async function makeClient(domains: string[] = ['example.com'], archivedAt: Date | null = null) {
  return prisma.client.create({
    data: { name: `${PREFIX}${Date.now()}-${counter++}`, domains: JSON.stringify(domains), archivedAt },
  })
}

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/clients/1/robots-checks', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const detailParams = (id: string, checkId: string) => ({ params: Promise.resolve({ id, checkId }) })

describe('POST /api/clients/[id]/robots-checks', () => {
  it('400 invalid id (strict: abc, 01, 1.0, +1, 1e2) / 404 unknown client / 409 archived', async () => {
    for (const bad of ['abc', '01', '1.0', '+1', '1e2', '0', '-1']) {
      expect((await POST(postReq({ domain: 'example.com' }), params(bad))).status).toBe(400)
    }
    expect((await POST(postReq({ domain: 'example.com' }), params('999999'))).status).toBe(404)
    const archived = await makeClient(['example.com'], new Date())
    const res = await POST(postReq({ domain: 'example.com' }), params(String(archived.id)))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('client_archived')
  })

  it('JSON null body -> 400 invalid_domain, never a 500 (plan-Codex #4)', async () => {
    const client = await makeClient(['example.com'])
    const res = await POST(postReq(null), params(String(client.id)))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_domain')
  })

  it('400 invalid_domain and 400 domain_not_listed', async () => {
    const client = await makeClient(['example.com'])
    const bad = await POST(postReq({ domain: 'http://ex ample' }), params(String(client.id)))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('invalid_domain')
    const notListed = await POST(postReq({ domain: 'other.com' }), params(String(client.id)))
    expect(notListed.status).toBe(400)
    expect((await notListed.json()).error).toBe('domain_not_listed')
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('runs the check with source manual and returns summary+detail', async () => {
    const client = await makeClient(['example.com'])
    mockRun.mockResolvedValueOnce({
      summary: { id: 1, domain: 'example.com', source: 'manual', robotsStatus: 'ok', sitemapUrlTotal: 2, errorCount: 0, warningCount: 0, changed: null, createdAt: new Date().toISOString() },
      detail: { v: 1 } as never,
    })
    const res = await POST(postReq({ domain: 'example.com' }), params(String(client.id)))
    expect(res.status).toBe(200)
    expect(mockRun).toHaveBeenCalledWith(client.id, 'example.com', { source: 'manual' })
    const body = await res.json()
    expect(body.summary.robotsStatus).toBe('ok')
  })

  it('malformed JSON body -> 400', async () => {
    const client = await makeClient(['example.com'])
    const req = new NextRequest('http://localhost/x', { method: 'POST', body: '{nope', headers: { 'content-type': 'application/json' } })
    const res = await POST(req, params(String(client.id)))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/clients/[id]/robots-checks', () => {
  it('400 invalid id / 404 unknown / 200 list; domain filter: syntax AND membership validated (plan-Codex #4)', async () => {
    expect((await GET(new NextRequest('http://localhost/x'), params('0'))).status).toBe(400)
    expect((await GET(new NextRequest('http://localhost/x'), params('999999'))).status).toBe(404)
    const client = await makeClient(['example.com'])
    const ok = await GET(new NextRequest('http://localhost/x'), params(String(client.id)))
    expect(ok.status).toBe(200)
    expect((await ok.json()).checks).toEqual([])
    const badDomain = await GET(new NextRequest('http://localhost/x?domain=..bad..'), params(String(client.id)))
    expect(badDomain.status).toBe(400)
    expect((await badDomain.json()).error).toBe('invalid_domain')
    const notListed = await GET(new NextRequest('http://localhost/x?domain=other.com'), params(String(client.id)))
    expect(notListed.status).toBe(400)
    expect((await notListed.json()).error).toBe('domain_not_listed')
  })
})

describe('GET /api/clients/[id]/robots-checks/[checkId]', () => {
  it('404 on not-found/unowned/corrupt (service null); 200 with summary+detail', async () => {
    const client = await makeClient(['example.com'])
    mockGet.mockResolvedValueOnce(null)
    expect((await GET_DETAIL(new NextRequest('http://localhost/x'), detailParams(String(client.id), '123'))).status).toBe(404)
    mockGet.mockResolvedValueOnce({ summary: { id: 5 } as never, detail: { v: 1 } as never })
    const ok = await GET_DETAIL(new NextRequest('http://localhost/x'), detailParams(String(client.id), '5'))
    expect(ok.status).toBe(200)
    expect((await ok.json()).summary.id).toBe(5)
    expect((await GET_DETAIL(new NextRequest('http://localhost/x'), detailParams(String(client.id), 'NaN'))).status).toBe(400)
  })
})
