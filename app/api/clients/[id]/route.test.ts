// B5 client soft-archive semantics: PATCH {archived}, DELETE gate, GET filter.
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { PATCH, DELETE } from './route'
import { GET as LIST } from '../route'

const PREFIX = '__clarch__'

const routeParams = (id: number) => ({ params: Promise.resolve({ id: String(id) }) })

function jsonReq(method: string, body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/clients/1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function makeClient(tag: string, archived = false) {
  return prisma.client.create({
    data: { name: `${PREFIX}${tag}`, archivedAt: archived ? new Date() : null },
  })
}

async function clear() {
  await prisma.schedule.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}

beforeEach(clear)
afterAll(clear)

describe('PATCH /api/clients/:id archive/restore', () => {
  it('archives: sets archivedAt and disables enabled schedules', async () => {
    const c = await makeClient('arch')
    await prisma.schedule.create({
      data: { jobType: 'site-audit', cadence: 'every:30m', enabled: true, nextRunAt: new Date(), clientId: c.id },
    })
    const res = await PATCH(jsonReq('PATCH', { archived: true }), routeParams(c.id))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.archivedAt).not.toBeNull()
    const sched = await prisma.schedule.findFirst({ where: { clientId: c.id } })
    expect(sched!.enabled).toBe(false)
  })

  it('restores: nulls archivedAt and leaves schedules disabled', async () => {
    const c = await makeClient('rest', true)
    await prisma.schedule.create({
      data: { jobType: 'site-audit', cadence: 'every:30m', enabled: false, nextRunAt: new Date(), clientId: c.id },
    })
    const res = await PATCH(jsonReq('PATCH', { archived: false }), routeParams(c.id))
    expect(res.status).toBe(200)
    expect((await res.json()).archivedAt).toBeNull()
    expect((await prisma.schedule.findFirst({ where: { clientId: c.id } }))!.enabled).toBe(false)
  })

  it('rejects archived combined with other fields, non-boolean archived, unknown id', async () => {
    const c = await makeClient('bad')
    expect((await PATCH(jsonReq('PATCH', { archived: true, name: 'x' }), routeParams(c.id))).status).toBe(400)
    expect((await PATCH(jsonReq('PATCH', { archived: 'yes' }), routeParams(c.id))).status).toBe(400)
    expect((await PATCH(jsonReq('PATCH', { archived: true }), routeParams(99999999))).status).toBe(404)
  })
})

describe('DELETE /api/clients/:id archive gate', () => {
  it('409s archive_first for an active client', async () => {
    const c = await makeClient('gate')
    const res = await DELETE(jsonReq('DELETE', {}), routeParams(c.id))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('archive_first')
    expect(await prisma.client.count({ where: { id: c.id } })).toBe(1)
  })

  it('deletes an archived client', async () => {
    const c = await makeClient('deleteme', true)
    const res = await DELETE(jsonReq('DELETE', {}), routeParams(c.id))
    expect(res.status).toBe(200)
    expect(await prisma.client.count({ where: { id: c.id } })).toBe(0)
  })

  it('404s for an unknown client', async () => {
    expect((await DELETE(jsonReq('DELETE', {}), routeParams(99999999))).status).toBe(404)
  })
})

describe('GET /api/clients archived filter', () => {
  it('excludes archived by default; includeArchived=1 returns them with archivedAt', async () => {
    const active = await makeClient('lact')
    const archived = await makeClient('larch', true)
    const def = await (await LIST(new NextRequest('http://localhost/api/clients'))).json()
    const defIds = def.map((c: { id: number }) => c.id)
    expect(defIds).toContain(active.id)
    expect(defIds).not.toContain(archived.id)
    const all = await (await LIST(new NextRequest('http://localhost/api/clients?includeArchived=1'))).json()
    const row = all.find((c: { id: number }) => c.id === archived.id)
    expect(row).toBeTruthy()
    expect(row.archivedAt).not.toBeNull()
  })
})

describe('PATCH /api/clients/:id domain validation', () => {
  it('normalizes, lowercases, and dedupes valid domains', async () => {
    const c = await makeClient('dvalid')
    const res = await PATCH(
      jsonReq('PATCH', { domains: ['Example.com', 'example.com', 'WWW.School.EDU'] }),
      routeParams(c.id),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.domains).toEqual(['example.com', 'www.school.edu'])
  })

  it('rejects malformed domains with 400 invalid_domain and persists nothing', async () => {
    const c = await makeClient('dbad')
    for (const bad of ['javascript:alert(1)', '../../etc/passwd', 'http://example.com', 'localhost', '127.0.0.1', 'example.com:443']) {
      const res = await PATCH(jsonReq('PATCH', { domains: ['example.com', bad] }), routeParams(c.id))
      expect(res.status, bad).toBe(400)
      expect((await res.json()).error).toBe('invalid_domain')
    }
    const fresh = await prisma.client.findUnique({ where: { id: c.id }, select: { domains: true } })
    expect(fresh?.domains).toBe('[]') // unchanged from default
  })
})
