import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET, PUT } from './route'
import { POST as IMPORT } from './import/route'
import { GET as ACTIVITY } from './activity/route'
import { POST as MINT } from './push/mint-token/route'
import { GET as EXPORT } from './push/[planId]/route'
import { POST as RECEIPT } from './push/[planId]/receipt/route'
import { mintQuarterPushToken } from '@/lib/quarter-push-token'
import { getClientQuarterContext } from '@/lib/services/client-quarter'
import { SignJWT } from 'jose'
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
  it('400 invalid_json on malformed', async () => {
    const bad = new NextRequest('http://localhost/api/quarter-plan/import', { method: 'POST', body: 'nope{' })
    const res = await IMPORT(bad)
    expect(res.status).toBe(400)
    // A3: normalized from "Invalid JSON body"
    expect((await res.json()).error).toBe('invalid_json')
  })

  it('400 with sanitizePlanPayload error on invalid payload shape', async () => {
    const res = await IMPORT(jsonReq('POST', null))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid payload')
  })

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

describe('quarter push routes (B5)', () => {
  const bearerReq = (url: string, token: string | null, init: { method?: string; body?: string } = {}) =>
    new NextRequest(url, {
      method: init.method ?? 'GET',
      headers: token ? { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {},
      body: init.body,
    })

  const pushableRow = (clientId: number): Partial<AssignmentPayload> =>
    ({ clientId, week: 3, position: 0, priority: 2, status: 'in_progress', note: 'cycle note', completed: false })

  // Hand-mint a qct_ token with arbitrary claims/secret/expiry, mirroring the
  // lib's own signing config (issuer/audience) so only the deliberately-wrong
  // field trips verification.
  async function signQct(
    planId: string,
    opts: { scope?: string[]; expiresIn?: string; secret?: string } = {},
  ): Promise<string> {
    const secret = new TextEncoder().encode(opts.secret ?? 'dev-quarter-push-secret-do-not-use-in-prod')
    const jwt = await new SignJWT({ scope: opts.scope ?? ['read', 'receipt-write'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('er-seo-tools').setAudience('quarter-cycle-push').setSubject(planId)
      .setIssuedAt().setExpirationTime(opts.expiresIn ?? '1h').sign(secret)
    return `qct_${jwt}`
  }

  async function makePushablePlan() {
    const clientId = await makeClient('push')
    await prisma.client.update({ where: { id: clientId }, data: { teamworkTasklistId: '12345' } })
    await PUT(jsonReq('PUT', payload([pushableRow(clientId)])))
    const plan = (await prisma.quarterPlan.findFirst())!
    return { clientId, planId: plan.id }
  }

  it('mint: 401 auth_required with no auth cookie (password auth configured)', async () => {
    // isValidAuthCookie dev-bypasses when APP_AUTH_PASSWORD is unset — stub it
    // so the no-cookie path actually exercises the 401 branch.
    vi.stubEnv('APP_AUTH_PASSWORD', 'test-password')
    try {
      const res = await MINT(bearerReq('http://localhost/api/quarter-plan/push/mint-token', null, { method: 'POST' }))
      expect(res.status).toBe(401)
      expect((await res.json()).error).toBe('auth_required')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('mint: 409 no_plan when none, 409 nothing_planned when nothing pushable', async () => {
    expect((await MINT(bearerReq('http://localhost/api/quarter-plan/push/mint-token', null, { method: 'POST' }))).status).toBe(409)

    // Plan exists but: pool row, completed row, archived client, and no-tasklist client → nothing pushable.
    const noTasklist = await makeClient('no-tl')
    const completedId = await makeClient('done-tl')
    const archivedId = await makeClient('arch-tl')
    await prisma.client.update({ where: { id: completedId }, data: { teamworkTasklistId: '111' } })
    await prisma.client.update({ where: { id: archivedId }, data: { teamworkTasklistId: '222', archivedAt: new Date() } })
    await PUT(jsonReq('PUT', payload([
      { clientId: noTasklist, week: 1, position: 0, priority: 3, status: 'not_started', note: '', completed: false },
      { clientId: completedId, week: 2, position: 0, priority: 3, status: 'complete', note: '', completed: true },
    ])))
    // The archived client's row can't come through PUT (it drops archived) — create it directly.
    const plan = (await prisma.quarterPlan.findFirst())!
    await prisma.quarterAssignment.create({ data: { planId: plan.id, clientId: archivedId, week: 4, position: 0 } })
    const res = await MINT(bearerReq('http://localhost/api/quarter-plan/push/mint-token', null, { method: 'POST' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('nothing_planned')
  })

  it('mint: 200 with qct_ token and planId when a pushable row exists', async () => {
    const { planId } = await makePushablePlan()
    const res = await MINT(bearerReq('http://localhost/api/quarter-plan/push/mint-token', null, { method: 'POST' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.token).toMatch(/^qct_/)
    expect(json.planId).toBe(planId)
  })

  it('export: 401 without/with-wrong bearer; 200 with the contract shape', async () => {
    const { clientId, planId } = await makePushablePlan()
    const url = `http://localhost/api/quarter-plan/push/${planId}`
    const noAuth = await EXPORT(bearerReq(url, null), { params: Promise.resolve({ planId: String(planId) }) })
    expect(noAuth.status).toBe(401)
    expect((await noAuth.json()).error).toBe('auth_missing_or_malformed')

    const { token } = await mintQuarterPushToken(String(planId + 1)) // wrong plan
    const wrongPlan = await EXPORT(bearerReq(url, token), { params: Promise.resolve({ planId: String(planId) }) })
    expect(wrongPlan.status).toBe(401)
    expect((await wrongPlan.json()).error).toBe('token_wrong_plan_id')

    const good = await mintQuarterPushToken(String(planId))
    const res = await EXPORT(bearerReq(url, good.token), { params: Promise.resolve({ planId: String(planId) }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.planId).toBe(planId)
    expect(json.teamwork.markerFormat).toBe('quarter-cycle:{planId}:{clientId}:{week}')
    expect(json.teamwork.taskType).toBe('task')
    expect(json.assignments).toHaveLength(1)
    expect(json.assignments[0]).toMatchObject({
      clientId, week: 3, priority: 2, status: 'in_progress', note: 'cycle note',
      completed: false, tasklistId: '12345',
      weekStart: '2026-07-20', weekEnd: '2026-07-24', // payload() startDate 2026-07-06 + week 3
    })
  })

  it('export: excludes archived-client rows, includes completed rows; null dates without startDate', async () => {
    const { clientId, planId } = await makePushablePlan()
    // Flip: no startDate, row completed; add an archived client's planned row directly.
    await PUT(jsonReq('PUT', payload([{ ...pushableRow(clientId), completed: true }], { startDate: null })))
    const archivedId = await makeClient('exp-arch')
    await prisma.client.update({ where: { id: archivedId }, data: { archivedAt: new Date(), teamworkTasklistId: '999' } })
    await prisma.quarterAssignment.create({ data: { planId, clientId: archivedId, week: 5, position: 0 } })

    const { token } = await mintQuarterPushToken(String(planId))
    const json = await (await EXPORT(bearerReq(`http://localhost/api/quarter-plan/push/${planId}`, token), { params: Promise.resolve({ planId: String(planId) }) })).json()
    expect(json.assignments).toHaveLength(1) // archived row excluded
    expect(json.assignments[0]).toMatchObject({ clientId, completed: true, weekStart: null, weekEnd: null })
    expect(json.teamwork.titleFormat).toBe('[SEO] Quarter Cycle — Week {week}')
  })

  it('export: 404 when the plan no longer exists', async () => {
    const { planId } = await makePushablePlan()
    const { token } = await mintQuarterPushToken(String(planId))
    await prisma.quarterPlan.deleteMany({})
    const res = await EXPORT(bearerReq(`http://localhost/api/quarter-plan/push/${planId}`, token), { params: Promise.resolve({ planId: String(planId) }) })
    expect(res.status).toBe(404)
  })

  it('export: 404 not_found when a newer plan supersedes the token\'s plan', async () => {
    const { planId } = await makePushablePlan()
    const { token } = await mintQuarterPushToken(String(planId))
    await prisma.quarterPlan.create({ data: { name: 'newer plan' } }) // now the latest — old token's plan is stale
    const res = await EXPORT(bearerReq(`http://localhost/api/quarter-plan/push/${planId}`, token), { params: Promise.resolve({ planId: String(planId) }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })

  it('export: 401 token_missing_scope without \'read\'; hand-minted expired/bad-sig tokens', async () => {
    const { planId } = await makePushablePlan()
    const url = `http://localhost/api/quarter-plan/push/${planId}`
    const routeParams = { params: Promise.resolve({ planId: String(planId) }) }

    const noReadScope = await signQct(String(planId), { scope: ['receipt-write'] })
    const noReadRes = await EXPORT(bearerReq(url, noReadScope), routeParams)
    expect(noReadRes.status).toBe(401)
    expect((await noReadRes.json()).error).toBe('token_missing_scope')

    const badSig = await signQct(String(planId), { secret: 'a-completely-different-signing-secret' })
    const badSigRes = await EXPORT(bearerReq(url, badSig), routeParams)
    expect(badSigRes.status).toBe(401)
    expect((await badSigRes.json()).error).toBe('token_invalid_signature')

    // Wart, pinned as-is: tokenErrorCode()'s 'expired' substring check never
    // matches jose's real expiry message ('"exp" claim timestamp check
    // failed'), so an actually-expired token falls through to token_invalid,
    // not token_expired.
    const expired = await signQct(String(planId), { expiresIn: '-10s' })
    const expiredRes = await EXPORT(bearerReq(url, expired), routeParams)
    expect(expiredRes.status).toBe(401)
    expect((await expiredRes.json()).error).toBe('token_invalid')
  })

  it('receipt: 401 auth_missing_or_malformed without a bearer token', async () => {
    const { planId } = await makePushablePlan()
    const res = await RECEIPT(
      bearerReq(`http://localhost/api/quarter-plan/push/${planId}/receipt`, null, { method: 'POST', body: JSON.stringify({ created: 1 }) }),
      { params: Promise.resolve({ planId: String(planId) }) },
    )
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('auth_missing_or_malformed')
  })

  it('receipt: 401 token_invalid_signature and token_wrong_plan_id for hand-minted bad tokens', async () => {
    const { planId } = await makePushablePlan()
    const url = `http://localhost/api/quarter-plan/push/${planId}/receipt`
    const routeParams = { params: Promise.resolve({ planId: String(planId) }) }

    const badSig = await signQct(String(planId), { secret: 'a-completely-different-signing-secret' })
    const badSigRes = await RECEIPT(bearerReq(url, badSig, { method: 'POST', body: JSON.stringify({ created: 1 }) }), routeParams)
    expect(badSigRes.status).toBe(401)
    expect((await badSigRes.json()).error).toBe('token_invalid_signature')

    const { token: wrongPlanToken } = await mintQuarterPushToken(String(planId + 1))
    const wrongPlanRes = await RECEIPT(bearerReq(url, wrongPlanToken, { method: 'POST', body: JSON.stringify({ created: 1 }) }), routeParams)
    expect(wrongPlanRes.status).toBe(401)
    expect((await wrongPlanRes.json()).error).toBe('token_wrong_plan_id')
  })

  it('receipt: 401 for a read-only token (scope enforcement)', async () => {
    const { planId } = await makePushablePlan()
    // Hand-mint a qct_ token WITHOUT receipt-write, using the lib's dev fallback secret.
    const secret = new TextEncoder().encode('dev-quarter-push-secret-do-not-use-in-prod')
    const jwt = await new SignJWT({ scope: ['read'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('er-seo-tools').setAudience('quarter-cycle-push').setSubject(String(planId))
      .setIssuedAt().setExpirationTime('1h').sign(secret)
    const res = await RECEIPT(
      bearerReq(`http://localhost/api/quarter-plan/push/${planId}/receipt`, `qct_${jwt}`, { method: 'POST', body: JSON.stringify({ created: 1 }) }),
      { params: Promise.resolve({ planId: String(planId) }) },
    )
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('token_missing_scope')
  })

  it('receipt: 200 stamps metadata with clamped counts; 400 malformed JSON; 404 non-latest plan', async () => {
    const { planId } = await makePushablePlan()
    const { token } = await mintQuarterPushToken(String(planId))
    const url = `http://localhost/api/quarter-plan/push/${planId}/receipt`
    const routeParams = { params: Promise.resolve({ planId: String(planId) }) }

    const ok = await RECEIPT(bearerReq(url, token, { method: 'POST', body: JSON.stringify({ created: 3.7, skippedExisting: -2, skippedNoTasklist: 'x', skippedCompleted: 1 }) }), routeParams)
    expect(ok.status).toBe(200)
    const plan = (await prisma.quarterPlan.findFirst())!
    expect(plan.teamworkPushedAt).not.toBeNull()
    expect(JSON.parse(plan.teamworkPushSummary!)).toEqual({ created: 3, skippedExisting: 0, skippedNoTasklist: 0, skippedCompleted: 1 })

    expect((await RECEIPT(bearerReq(url, token, { method: 'POST', body: 'nope{' }), routeParams)).status).toBe(400)

    // A newer plan supersedes — the old token's receipt must 404.
    await prisma.quarterPlan.create({ data: { name: 'newer' } })
    expect((await RECEIPT(bearerReq(url, token, { method: 'POST', body: JSON.stringify({ created: 1 }) }), routeParams)).status).toBe(404)
  })
})

describe('getClientQuarterContext (B5 — lives here: touches the singleton plan table)', () => {
  const QC_DOMAIN = 'cq-b5.example'
  afterAll(async () => { await prisma.crawlRun.deleteMany({ where: { domain: QC_DOMAIN } }) })

  it('returns null when no plan exists or client has no assignment', async () => {
    const c = await makeClient('qc-none')
    expect(await getClientQuarterContext(c)).toBeNull()
    await prisma.quarterPlan.create({ data: { name: 'Q3 plan', startDate: '2026-07-06' } })
    expect(await getClientQuarterContext(c)).toBeNull()
  })

  it('returns pool context (week null) without a weekRange', async () => {
    const c = await makeClient('qc-pool')
    const plan = await prisma.quarterPlan.create({ data: { name: 'Q3 plan', startDate: '2026-07-06' } })
    await prisma.quarterAssignment.create({ data: { planId: plan.id, clientId: c, priority: 2, status: 'on_hold', note: 'parked' } })
    const ctx = (await getClientQuarterContext(c))!
    expect(ctx).toMatchObject({ week: null, weekRange: null, priority: 2, status: 'on_hold', note: 'parked', completed: false, latestActivity: null })
  })

  it('returns scheduled context with weekRange, completion, and latest activity', async () => {
    const c = await makeClient('qc-sched')
    const plan = await prisma.quarterPlan.create({ data: { name: 'Q3 plan', startDate: '2026-07-06' } })
    const doneAt = new Date('2026-07-20T10:00:00Z')
    await prisma.quarterAssignment.create({ data: { planId: plan.id, clientId: c, week: 3, position: 0, priority: 1, completedAt: doneAt } })
    await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'site-audit', domain: QC_DOMAIN, clientId: c, status: 'complete', pagesTotal: 5, completedAt: new Date('2026-07-21T10:00:00Z') },
    })
    const ctx = (await getClientQuarterContext(c))!
    expect(ctx.week).toBe(3)
    expect(ctx.weekRange).toBe('7/20–7/24')
    expect(ctx.completed).toBe(true)
    expect(ctx.completedAt).toBe(doneAt.toISOString())
    expect(ctx.latestActivity).toMatchObject({ kind: 'ada-audit' })
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
