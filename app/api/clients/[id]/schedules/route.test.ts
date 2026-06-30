// app/api/clients/[id]/schedules/route.test.ts
//
// C2 schedule CRUD — covers both route files (collection + item).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET, POST } from './route'
import { PATCH, DELETE } from './[scheduleId]/route'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'

const PREFIX = 'c2sched-rt-'
let clientId: number

function jsonReq(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/clients/x/schedules', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function p(id: number | string): { params: Promise<{ id: string }> }
function p(id: number | string, scheduleId: string): { params: Promise<{ id: string; scheduleId: string }> }
function p(id: number | string, scheduleId?: string) {
  return scheduleId
    ? { params: Promise.resolve({ id: String(id), scheduleId }) }
    : { params: Promise.resolve({ id: String(id) }) }
}

const createdJobIds: string[] = []

beforeAll(async () => {
  // Pre-clean leftovers from a failed prior run (Client delete cascades
  // its Schedule rows).
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
  const client = await prisma.client.create({
    data: { name: `${PREFIX}client`, domains: JSON.stringify([`${PREFIX}a.example.edu`, `${PREFIX}b.example.edu`]) },
  })
  clientId = client.id
})

afterAll(async () => {
  // Scoped cleanup only — never broad deleteMany on shared Job/Schedule tables.
  await prisma.job.deleteMany({ where: { id: { in: createdJobIds } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } }) // cascades schedules
})

describe('POST /api/clients/[id]/schedules', () => {
  it('creates a weekly schedule with server-built payload and future nextRunAt', async () => {
    const res = await POST(jsonReq('POST', { domain: `${PREFIX}a.example.edu`, cadence: 'weekly:1@06:00', wcagLevel: 'wcag22aa' }), p(clientId))
    expect(res.status).toBe(201)
    const { id } = await res.json()
    const sched = await prisma.schedule.findUnique({ where: { id } })
    expect(sched?.jobType).toBe(SCHEDULED_SITE_AUDIT_JOB_TYPE)
    expect(sched?.clientId).toBe(clientId)
    expect(sched?.name).toBeNull()
    expect(JSON.parse(sched!.payload)).toEqual({ clientId, domain: `${PREFIX}a.example.edu`, wcagLevel: 'wcag22aa', seoIntent: false })
    expect(sched!.nextRunAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('409 schedule_exists for a second schedule on the same domain', async () => {
    const res = await POST(jsonReq('POST', { domain: `${PREFIX}a.example.edu`, cadence: 'monthly:1@06:00' }), p(clientId))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('schedule_exists')
  })

  it('400 domain_not_listed for a domain not on the client', async () => {
    const res = await POST(jsonReq('POST', { domain: 'evil.example.com', cadence: 'weekly:1@06:00' }), p(clientId))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('domain_not_listed')
  })

  it('400 cadence_invalid for unparseable cadence', async () => {
    const res = await POST(jsonReq('POST', { domain: `${PREFIX}b.example.edu`, cadence: 'sometimes' }), p(clientId))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('cadence_invalid')
  })

  it.each(['daily@06:00', 'every:30m', 'every:1d', 'every:7d', 'every:14d'])('400 cadence_not_allowed for non-weekly/monthly %s', async (cadence) => {
    const res = await POST(jsonReq('POST', { domain: `${PREFIX}b.example.edu`, cadence }), p(clientId))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('cadence_not_allowed')
  })

  it('409 client_archived for an archived client', async () => {
    const archived = await prisma.client.create({
      data: { name: `${PREFIX}archived`, domains: JSON.stringify([`${PREFIX}c.example.edu`]), archivedAt: new Date() },
    })
    const res = await POST(jsonReq('POST', { domain: `${PREFIX}c.example.edu`, cadence: 'weekly:1@06:00' }), p(archived.id))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('client_archived')
  })

  it('404 for unknown client, 400 for bad id, 400 for bad JSON', async () => {
    expect((await POST(jsonReq('POST', { domain: 'x.edu', cadence: 'weekly:1@06:00' }), p(999_999))).status).toBe(404)
    expect((await POST(jsonReq('POST', { domain: 'x.edu', cadence: 'weekly:1@06:00' }), p('abc'))).status).toBe(400)
    const badJson = new NextRequest('http://localhost/api/x', { method: 'POST', body: '{nope' })
    expect((await POST(badJson, p(clientId))).status).toBe(400)
  })

  it('400 invalid_domain when scheduling a malformed domain, even if it is in the stored array (legacy data)', async () => {
    // Pentest regression: a malformed domain persisted before validation existed
    // must NOT be schedulable just because it is in the client's domains list.
    const legacy = await prisma.client.create({
      data: {
        name: `${PREFIX}legacy-bad`,
        domains: JSON.stringify(['example.com', 'javascript:alert(1)']),
      },
    })
    const res = await POST(
      jsonReq('POST', { domain: 'javascript:alert(1)', cadence: 'weekly:1@06:00' }),
      p(legacy.id),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_domain')
  })
})

describe('GET /api/clients/[id]/schedules', () => {
  it('lists schedules with payload-derived domain', async () => {
    const res = await GET(jsonReq('GET'), p(clientId))
    expect(res.status).toBe(200)
    const { schedules } = await res.json()
    expect(schedules.some((s: { domain: string }) => s.domain === `${PREFIX}a.example.edu`)).toBe(true)
  })

  it('404 for unknown client', async () => {
    expect((await GET(jsonReq('GET'), p(999_999))).status).toBe(404)
  })
})

describe('PATCH/DELETE /api/clients/[id]/schedules/[scheduleId]', () => {
  it('pause sets enabled=false; resume recomputes nextRunAt from now', async () => {
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId, cadence: 'weekly:1@06:00',
        payload: JSON.stringify({ clientId, domain: `${PREFIX}b.example.edu`, wcagLevel: 'wcag21aa' }),
        nextRunAt: new Date('2020-01-01T00:00:00Z'), // stale past slot
        enabled: true,
      },
    })
    const off = await PATCH(jsonReq('PATCH', { enabled: false }), p(clientId, sched.id))
    expect(off.status).toBe(200)
    expect((await prisma.schedule.findUnique({ where: { id: sched.id } }))?.enabled).toBe(false)

    const on = await PATCH(jsonReq('PATCH', { enabled: true }), p(clientId, sched.id))
    expect(on.status).toBe(200)
    const after = await prisma.schedule.findUnique({ where: { id: sched.id } })
    expect(after?.enabled).toBe(true)
    expect(after!.nextRunAt.getTime()).toBeGreaterThan(Date.now()) // not the stale 2020 slot
    await prisma.schedule.delete({ where: { id: sched.id } })
  })

  it('400 when enabled is missing or not boolean', async () => {
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId, cadence: 'weekly:1@06:00',
        payload: '{}', nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    expect((await PATCH(jsonReq('PATCH', { enabled: 'yes' }), p(clientId, sched.id))).status).toBe(400)
    expect((await PATCH(jsonReq('PATCH', {}), p(clientId, sched.id))).status).toBe(400)
    await prisma.schedule.delete({ where: { id: sched.id } })
  })

  it('409 client_archived when resuming a schedule on an archived client', async () => {
    const archived = await prisma.client.create({
      data: { name: `${PREFIX}arch-resume`, domains: JSON.stringify([`${PREFIX}d.example.edu`]), archivedAt: new Date() },
    })
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId: archived.id, cadence: 'weekly:1@06:00',
        payload: JSON.stringify({ clientId: archived.id, domain: `${PREFIX}d.example.edu`, wcagLevel: 'wcag21aa' }),
        nextRunAt: new Date('2099-01-01T00:00:00Z'), enabled: false,
      },
    })
    const res = await PATCH(jsonReq('PATCH', { enabled: true }), p(archived.id, sched.id))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('client_archived')
    expect((await prisma.schedule.findUnique({ where: { id: sched.id } }))?.enabled).toBe(false)
    // pausing (enabled:false) stays allowed for archived clients
    expect((await PATCH(jsonReq('PATCH', { enabled: false }), p(archived.id, sched.id))).status).toBe(200)
  })

  it('DELETE removes the schedule, cancels its queued jobs, SetNulls its audits', async () => {
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId, cadence: 'weekly:1@06:00',
        payload: JSON.stringify({ clientId, domain: `${PREFIX}b.example.edu`, wcagLevel: 'wcag21aa' }),
        nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    const job = await prisma.job.create({
      data: { type: SCHEDULED_SITE_AUDIT_JOB_TYPE, status: 'queued', payload: '{}', groupKey: `schedule:${sched.id}`, scheduleId: sched.id, scheduledFor: new Date() },
    })
    createdJobIds.push(job.id)
    const audit = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}b.example.edu`, status: 'complete', wcagLevel: 'wcag21aa', scheduleId: sched.id, completedAt: new Date() },
    })

    const res = await DELETE(jsonReq('DELETE'), p(clientId, sched.id))
    expect(res.status).toBe(200)
    expect(await prisma.schedule.findUnique({ where: { id: sched.id } })).toBeNull()
    expect((await prisma.job.findUnique({ where: { id: job.id } }))?.status).toBe('cancelled')
    expect((await prisma.siteAudit.findUnique({ where: { id: audit.id } }))?.scheduleId).toBeNull()
  })

  it('404 when the schedule belongs to another client or another jobType', async () => {
    const other = await prisma.client.create({ data: { name: `${PREFIX}other`, domains: '[]' } })
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId: other.id, cadence: 'weekly:1@06:00',
        payload: '{}', nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    expect((await PATCH(jsonReq('PATCH', { enabled: false }), p(clientId, sched.id))).status).toBe(404)
    expect((await DELETE(jsonReq('DELETE'), p(clientId, sched.id))).status).toBe(404)
  })
})

describe('D1: seoIntent coexistence', () => {
  let d1ClientId: number
  const d1Domain = `${PREFIX}seoint.example.edu`

  beforeAll(async () => {
    const c = await prisma.client.create({
      data: { name: `${PREFIX}d1-client`, domains: JSON.stringify([d1Domain]) },
    })
    d1ClientId = c.id
  })

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { name: `${PREFIX}d1-client` } })
  })

  it('creates an ADA schedule (seoIntent omitted/false) for a domain', async () => {
    const res = await POST(
      jsonReq('POST', { domain: d1Domain, cadence: 'weekly:1@06:00', wcagLevel: 'wcag21aa' }),
      p(d1ClientId),
    )
    expect(res.status).toBe(201)
    const { id } = await res.json()
    const sched = await prisma.schedule.findUnique({ where: { id } })
    const payload = JSON.parse(sched!.payload) as Record<string, unknown>
    expect(payload.seoIntent).toBeFalsy()
  })

  it('creates a separate SEO schedule (seoIntent:true) for the SAME domain — coexist', async () => {
    const res = await POST(
      jsonReq('POST', { domain: d1Domain, cadence: 'weekly:1@06:00', wcagLevel: 'wcag21aa', seoIntent: true }),
      p(d1ClientId),
    )
    expect(res.status).toBe(201)
    const { id } = await res.json()
    const sched = await prisma.schedule.findUnique({ where: { id } })
    const payload = JSON.parse(sched!.payload) as Record<string, unknown>
    expect(payload.seoIntent).toBe(true)
  })

  it('409 schedule_exists when creating a duplicate SEO schedule for the same domain', async () => {
    const res = await POST(
      jsonReq('POST', { domain: d1Domain, cadence: 'monthly:1@06:00', wcagLevel: 'wcag21aa', seoIntent: true }),
      p(d1ClientId),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('schedule_exists')
  })

  it('409 schedule_exists when creating a duplicate ADA schedule for the same domain', async () => {
    const res = await POST(
      jsonReq('POST', { domain: d1Domain, cadence: 'monthly:1@06:00', wcagLevel: 'wcag21aa' }),
      p(d1ClientId),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('schedule_exists')
  })

  it('GET returns seoIntent on each schedule row', async () => {
    const res = await GET(jsonReq('GET'), p(d1ClientId))
    expect(res.status).toBe(200)
    const { schedules } = (await res.json()) as { schedules: Array<{ domain: string; seoIntent: boolean }> }
    const mine = schedules.filter((s) => s.domain === d1Domain)
    expect(mine).toHaveLength(2)
    const adaSched = mine.find((s) => !s.seoIntent)
    const seoSched = mine.find((s) => s.seoIntent)
    expect(adaSched).toBeDefined()
    expect(seoSched).toBeDefined()
  })
})
