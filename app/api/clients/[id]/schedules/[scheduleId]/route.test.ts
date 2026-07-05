// A3 Phase 1 characterization: PATCH/DELETE /api/clients/[id]/schedules/[scheduleId], AS-IS.
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { PATCH, DELETE } from './route'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'

const PREFIX = '__a3sched__'

const params = (clientId: number | string, scheduleId: string) => ({
  params: Promise.resolve({ id: String(clientId), scheduleId }),
})

function jsonReq(method: string, body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/clients/1/schedules/1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function rawReq(method: string, rawBody: string): NextRequest {
  return new NextRequest('http://localhost/api/clients/1/schedules/1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: rawBody,
  })
}

async function clear() {
  await prisma.schedule.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}

beforeEach(clear)
afterAll(clear)

async function makeClient(tag: string, archived = false) {
  return prisma.client.create({
    data: { name: `${PREFIX}${tag}`, archivedAt: archived ? new Date() : null },
  })
}

async function makeSchedule(clientId: number, opts: { enabled?: boolean; cadence?: string } = {}) {
  return prisma.schedule.create({
    data: {
      jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE,
      cadence: opts.cadence ?? 'weekly:1@09:00',
      enabled: opts.enabled ?? true,
      nextRunAt: new Date(),
      clientId,
    },
  })
}

describe('PATCH /api/clients/[id]/schedules/[scheduleId]', () => {
  it('400 invalid_json on malformed body', async () => {
    const c = await makeClient('badjson')
    const sched = await makeSchedule(c.id)
    const res = await PATCH(rawReq('PATCH', '{not json'), params(c.id, sched.id))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
  })

  it('400 enabled_required when enabled is absent or non-boolean', async () => {
    const c = await makeClient('noenabled')
    const sched = await makeSchedule(c.id)
    const res1 = await PATCH(jsonReq('PATCH', {}), params(c.id, sched.id))
    expect(res1.status).toBe(400)
    expect((await res1.json()).error).toBe('enabled_required')

    const res2 = await PATCH(jsonReq('PATCH', { enabled: 'yes' }), params(c.id, sched.id))
    expect(res2.status).toBe(400)
    expect((await res2.json()).error).toBe('enabled_required')
  })

  it('404 not_found for a schedule not owned by the client', async () => {
    const owner = await makeClient('owner')
    const other = await makeClient('other')
    const sched = await makeSchedule(owner.id)
    const res = await PATCH(jsonReq('PATCH', { enabled: false }), params(other.id, sched.id))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })

  it('409 client_archived when re-enabling on an archived client', async () => {
    const c = await makeClient('archived', true)
    const sched = await makeSchedule(c.id, { enabled: false })
    const res = await PATCH(jsonReq('PATCH', { enabled: true }), params(c.id, sched.id))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('client_archived')
  })

  it('200 { ok: true } enabling a schedule on an active client', async () => {
    const c = await makeClient('enable')
    const sched = await makeSchedule(c.id, { enabled: false })
    const res = await PATCH(jsonReq('PATCH', { enabled: true }), params(c.id, sched.id))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const fresh = await prisma.schedule.findUnique({ where: { id: sched.id } })
    expect(fresh?.enabled).toBe(true)
  })

  it('200 { ok: true } disabling a schedule', async () => {
    const c = await makeClient('disable')
    const sched = await makeSchedule(c.id, { enabled: true })
    const res = await PATCH(jsonReq('PATCH', { enabled: false }), params(c.id, sched.id))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const fresh = await prisma.schedule.findUnique({ where: { id: sched.id } })
    expect(fresh?.enabled).toBe(false)
  })
})

describe('DELETE /api/clients/[id]/schedules/[scheduleId]', () => {
  it('404 not_found for a missing schedule', async () => {
    const c = await makeClient('delmissing')
    const res = await DELETE(jsonReq('DELETE', {}), params(c.id, 'does-not-exist'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })

  it('200 { ok: true } on success and removes the Schedule row', async () => {
    const c = await makeClient('delok')
    const sched = await makeSchedule(c.id)
    const res = await DELETE(jsonReq('DELETE', {}), params(c.id, sched.id))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(await prisma.schedule.count({ where: { id: sched.id } })).toBe(0)
  })
})
