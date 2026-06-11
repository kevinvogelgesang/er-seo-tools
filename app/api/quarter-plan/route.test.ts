import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET, PUT } from './route'
import { POST as IMPORT } from './import/route'
import { GET as ACTIVITY } from './activity/route'
import type { AssignmentPayload } from '@/lib/quarter-grid/state'

// NOTE: QuarterPlan is a singleton over the shared dev DB — these tests
// delete ALL plan rows in beforeEach. Keep every quarter-plan API test in
// THIS file so vitest's parallel file execution can't interleave them.

const PREFIX = '__qpt__'

function jsonReq(method: string, body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/quarter-plan', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function makeClient(name: string): Promise<number> {
  const c = await prisma.client.create({ data: { name: `${PREFIX}${name}` } })
  return c.id
}

function payload(assignments: Partial<AssignmentPayload>[], extra: Record<string, unknown> = {}) {
  return {
    name: 'Test plan',
    startDate: '2026-07-06',
    slotsPerWeek: 2,
    layouts: {},
    assignments,
    ...extra,
  }
}

async function cleanup() {
  await prisma.quarterPlan.deleteMany({}) // global singleton — assignments cascade
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}

beforeEach(cleanup)
afterAll(cleanup)

describe('GET /api/quarter-plan', () => {
  it('returns { plan: null } when no plan exists', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ plan: null })
  })

  it('orders assignments: assigned by week/position, pool last', async () => {
    const [a, b, c] = await Promise.all([makeClient('a'), makeClient('b'), makeClient('c')])
    await PUT(jsonReq('PUT', payload([
      { clientId: c, week: null, position: null, priority: 3, status: 'not_started', note: '', completed: false },
      { clientId: b, week: 1, position: 1, priority: 3, status: 'not_started', note: '', completed: false },
      { clientId: a, week: 1, position: 0, priority: 3, status: 'not_started', note: '', completed: false },
    ])))
    const json = await (await GET()).json()
    expect(json.assignments.map((r: AssignmentPayload) => r.clientId)).toEqual([a, b, c])
  })
})

describe('PUT /api/quarter-plan', () => {
  it('creates exactly one plan, second PUT updates it', async () => {
    const id = await makeClient('one')
    const res1 = await PUT(jsonReq('PUT', payload([{ clientId: id, week: 2, position: 0, priority: 1, status: 'in_progress', note: 'n', completed: false }])))
    expect(res1.status).toBe(200)
    const res2 = await PUT(jsonReq('PUT', payload([], { name: 'Renamed' })))
    expect(res2.status).toBe(200)
    expect(await prisma.quarterPlan.count()).toBe(1)
    const json = await res2.json()
    expect(json.plan.name).toBe('Renamed')
    expect(json.assignments).toHaveLength(0) // replace-all: empty save wipes rows
  })

  it('preserves completedAt across re-saves, stamps new, nulls uncompleted', async () => {
    const id = await makeClient('done')
    const row = { clientId: id, week: null, position: null, priority: 3, status: 'not_started' as const, note: '', completed: true }
    await PUT(jsonReq('PUT', payload([row])))
    const first = (await prisma.quarterAssignment.findFirst({ where: { clientId: id } }))!.completedAt!
    await new Promise((r) => setTimeout(r, 5))
    await PUT(jsonReq('PUT', payload([row]))) // still completed → timestamp preserved
    const second = (await prisma.quarterAssignment.findFirst({ where: { clientId: id } }))!.completedAt!
    expect(second.getTime()).toBe(first.getTime())
    await PUT(jsonReq('PUT', payload([{ ...row, completed: false }])))
    expect((await prisma.quarterAssignment.findFirst({ where: { clientId: id } }))!.completedAt).toBeNull()
  })

  it('drops assignments for archived clients on PUT (server-side enforcement)', async () => {
    const active = await makeClient('b5-active')
    const archivedRow = await prisma.client.create({ data: { name: `${PREFIX}b5-archived`, archivedAt: new Date() } })
    const res = await PUT(jsonReq('PUT', payload([
      { clientId: active, week: 1, position: 0, priority: 3, status: 'not_started', note: '', completed: false },
      { clientId: archivedRow.id, week: 1, position: 1, priority: 3, status: 'not_started', note: '', completed: false },
    ])))
    expect(res.status).toBe(200)
    const rows = await prisma.quarterAssignment.findMany({})
    expect(rows.map((r) => r.clientId)).toContain(active)
    expect(rows.map((r) => r.clientId)).not.toContain(archivedRow.id)
  })

  it('drops rows for nonexistent clients without failing the save', async () => {
    const id = await makeClient('real')
    const res = await PUT(jsonReq('PUT', payload([
      { clientId: id, week: 1, position: 0, priority: 3, status: 'not_started', note: '', completed: false },
      { clientId: 99999999, week: 1, position: 1, priority: 3, status: 'not_started', note: '', completed: false },
    ])))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.assignments).toHaveLength(1)
    expect(json.assignments[0].clientId).toBe(id)
  })

  it('accepts a payload with zero assignments (no empty createMany)', async () => {
    const res = await PUT(jsonReq('PUT', payload([])))
    expect(res.status).toBe(200)
    expect(await prisma.quarterPlan.count()).toBe(1)
    expect(await prisma.quarterAssignment.count()).toBe(0)
  })

  it('clamps row fields server-side', async () => {
    const id = await makeClient('clamp')
    await PUT(jsonReq('PUT', payload([{ clientId: id, week: 99 as number, position: 0, priority: 9, status: 'bogus' as never, note: 'x'.repeat(400), completed: false }])))
    const row = (await prisma.quarterAssignment.findFirst({ where: { clientId: id } }))!
    expect(row.week).toBeNull()
    expect(row.position).toBeNull()
    expect(row.priority).toBe(5)
    expect(row.status).toBe('not_started')
    expect(row.note).toHaveLength(120)
  })

  it('preserves Teamwork push metadata across normal grid saves (read-only invariant)', async () => {
    await PUT(jsonReq('PUT', payload([])))
    const plan = (await prisma.quarterPlan.findFirst())!
    const pushedAt = new Date('2026-06-10T12:00:00Z')
    const summary = JSON.stringify({ created: 5, skippedExisting: 1, skippedNoTasklist: 2, skippedCompleted: 0 })
    await prisma.quarterPlan.update({ where: { id: plan.id }, data: { teamworkPushedAt: pushedAt, teamworkPushSummary: summary } })
    const res = await PUT(jsonReq('PUT', payload([], { name: 'Edited after push', teamworkPushedAt: null, teamworkPushSummary: null })))
    expect(res.status).toBe(200)
    const after = (await prisma.quarterPlan.findFirst())!
    expect(after.teamworkPushedAt!.getTime()).toBe(pushedAt.getTime())
    expect(after.teamworkPushSummary).toBe(summary)
    const json = await res.json()
    expect(json.plan.teamworkPushedAt).toBe(pushedAt.toISOString())
    expect(json.plan.teamworkPushSummary).toEqual({ created: 5, skippedExisting: 1, skippedNoTasklist: 2, skippedCompleted: 0 })
  })

  it('rejects invalid JSON and oversized layouts with 400', async () => {
    const bad = new NextRequest('http://localhost/api/quarter-plan', { method: 'PUT', body: 'nope{' })
    expect((await PUT(bad)).status).toBe(400)
    const big = payload([], { layouts: { l: { schedule: {}, completed: [], clients: [], pad: 'x'.repeat(300 * 1024) } } })
    expect((await PUT(jsonReq('PUT', big))).status).toBe(400)
  })
})

describe('POST /api/quarter-plan/import', () => {
  it('imports onto an empty DB', async () => {
    const id = await makeClient('imp')
    const res = await IMPORT(jsonReq('POST', payload([{ clientId: id, week: 3, position: 0, priority: 2, status: 'on_hold', note: 'memo', completed: true }])))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.plan.startDate).toBe('2026-07-06')
    expect(json.assignments[0]).toMatchObject({ clientId: id, week: 3, priority: 2, status: 'on_hold', note: 'memo', completed: true })
  })

  it('409s when a plan already exists', async () => {
    await PUT(jsonReq('PUT', payload([])))
    const res = await IMPORT(jsonReq('POST', payload([])))
    expect(res.status).toBe(409)
  })
})

describe('GET /api/quarter-plan/activity', () => {
  it('returns {} when no plan exists', async () => {
    const res = await ACTIVITY()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ activity: {} })
  })

  it('returns derived activity keyed by clientId for plan clients', async () => {
    const id = await makeClient('act')
    await PUT(jsonReq('PUT', payload(
      [{ clientId: id, week: 1, position: 0, priority: 3, status: 'not_started', note: '', completed: false }],
      { startDate: null }, // window falls back to plan.createdAt (now) — run below is after it
    )))
    await prisma.crawlRun.create({
      data: {
        tool: 'ada-audit', source: 'page-audit', domain: 'qp-activity.example', clientId: id,
        status: 'complete', pagesTotal: 1, completedAt: new Date(Date.now() + 1000),
      },
    })
    try {
      const json = await (await ACTIVITY()).json()
      expect(json.activity[id]).toBeTruthy()
      expect(json.activity[id].latest.kind).toBe('ada-audit')
      expect(json.activity[id].kinds['ada-audit']).toBeTruthy()
    } finally {
      await prisma.crawlRun.deleteMany({ where: { domain: 'qp-activity.example' } })
    }
  })
})

describe('cascades', () => {
  it('deleting a client cascades its assignment rows', async () => {
    const id = await makeClient('gone')
    await PUT(jsonReq('PUT', payload([{ clientId: id, week: 1, position: 0, priority: 3, status: 'not_started', note: '', completed: false }])))
    await prisma.client.delete({ where: { id } })
    expect(await prisma.quarterAssignment.count({ where: { clientId: id } })).toBe(0)
    expect(await prisma.quarterPlan.count()).toBe(1) // plan survives
  })
})
