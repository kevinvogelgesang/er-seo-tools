// @vitest-environment jsdom
// components/quarter-grid/useQuarterPlan.test.tsx
import { renderHook, act, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { useQuarterPlan } from './useQuarterPlan'
import type { QuarterPlanGetResponse } from '@/lib/quarter-grid/state'

// This vitest jsdom setup exposes no working localStorage (window.localStorage
// is undefined) — provide an in-memory stand-in, re-stubbed per test because
// afterEach unstubs all globals.
const lsStore = new Map<string, string>()
const localStorageMock = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => { lsStore.set(k, String(v)) },
  removeItem: (k: string) => { lsStore.delete(k) },
  clear: () => { lsStore.clear() },
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); lsStore.clear() })
beforeEach(() => { lsStore.clear(); vi.stubGlobal('localStorage', localStorageMock) })

const DB_CLIENTS = [ { id: 1, name: 'Acme' }, { id: 2, name: 'Beta' } ]

const DB_PLAN: QuarterPlanGetResponse = {
  plan: { name: 'Quarter plan', startDate: '2026-01-05', slotsPerWeek: 2, layouts: {}, updatedAt: 'x', teamworkPushedAt: null, teamworkPushSummary: null },
  assignments: [
    { clientId: 1, week: 1, position: 0, priority: 2, status: 'in_progress', note: 'hi', completed: false },
    { clientId: 2, week: null, position: null, priority: 3, status: 'not_started', note: '', completed: true },
  ],
}

const LOCAL_PAYLOAD = JSON.stringify({
  clientState: { 1: { priority: 1, status: 'on_hold', note: 'ls' } },
  schedule: { 2: [1] }, completed: [], slotsPerWeek: 3, layouts: {}, startDate: '2026-01-05',
})

type RouteResponse = { ok: boolean; status?: number; json?: unknown }

type Routes = {
  clients?: RouteResponse
  planGet?: RouteResponse
  importPost?: RouteResponse | (() => Promise<Response>)
  put?: RouteResponse | (() => Promise<Response>)
  activity?: RouteResponse // optional — the hook tolerates a missing/failed activity endpoint
}

// Records every call; routes by method+path. Unrouted calls throw so a test
// can never silently hit an endpoint it didn't declare.
function stubFetch(routes: Routes) {
  const calls: { url: string; method: string; body?: unknown }[] = []
  const res = (r: RouteResponse) =>
    ({ ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.json ?? {} }) as Response
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined })
    if (url === '/api/clients' && method === 'GET') {
      if (!routes.clients) throw new Error('unrouted /api/clients')
      if (!routes.clients.ok && routes.clients.status === undefined) throw new Error('network down')
      return res(routes.clients)
    }
    if (url === '/api/quarter-plan' && method === 'GET') {
      if (!routes.planGet) throw new Error('unrouted GET /api/quarter-plan')
      return res(routes.planGet)
    }
    if (url === '/api/quarter-plan/import' && method === 'POST') {
      if (!routes.importPost) throw new Error('unrouted import POST')
      return typeof routes.importPost === 'function' ? routes.importPost() : res(routes.importPost)
    }
    if (url === '/api/quarter-plan' && method === 'PUT') {
      if (!routes.put) throw new Error('unrouted PUT /api/quarter-plan')
      return typeof routes.put === 'function' ? routes.put() : res(routes.put)
    }
    if (url === '/api/quarter-plan/activity' && method === 'GET') {
      // Undeclared → reject like a network failure; the hook must tolerate it.
      if (!routes.activity) throw new Error('activity endpoint down')
      return res(routes.activity)
    }
    throw new Error(`unrouted fetch ${method} ${url}`)
  }))
  return {
    calls,
    puts: () => calls.filter(c => c.method === 'PUT' && c.url === '/api/quarter-plan'),
    imports: () => calls.filter(c => c.method === 'POST' && c.url === '/api/quarter-plan/import'),
  }
}

async function renderPlan() {
  const onToast = vi.fn()
  const hook = renderHook(() => useQuarterPlan({ onToast }))
  // The init chain is sequential fetches + state updates + a follow-up effect
  // pass — one timer tick is not guaranteed to settle it. Wait for `loaded`
  // so a test's first edit can never accidentally consume the
  // skip-first-persist guard mid-init. (testing-library's waitFor can't
  // detect vitest fake timers with globals:false, so loop explicitly.)
  for (let i = 0; i < 50 && !hook.result.current.loaded; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  }
  expect(hook.result.current.loaded).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) }) // flush the post-load effect pass
  return { ...hook, onToast }
}

describe('useQuarterPlan init', () => {
  beforeEach(() => vi.useFakeTimers())

  it('DB plan exists → hydrates state, canPersist true, and NO PUT fires after init', async () => {
    const f = stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: DB_PLAN } })
    const { result } = await renderPlan()
    expect(result.current.loaded).toBe(true)
    expect(result.current.canPersist).toBe(true)
    expect(result.current.schedule).toEqual({ 1: [1] })
    expect(result.current.completed.has(2)).toBe(true)
    expect(result.current.clients.find(c => c.id === 1)).toMatchObject({ priority: 2, status: 'in_progress', note: 'hi' })
    expect(result.current.startDate).toBe('2026-01-05')
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(f.puts()).toHaveLength(0) // skip-first-persist: mere page-opens never write
  })

  it('confirmed-empty DB + no localStorage → zero imports and zero PUTs (armed import window)', async () => {
    const f = stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: { plan: null } } })
    const { result } = await renderPlan()
    expect(result.current.loaded).toBe(true)
    expect(result.current.canPersist).toBe(true) // saves allowed, but only on a real edit
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(f.imports()).toHaveLength(0)
    expect(f.puts()).toHaveLength(0)
  })

  it('empty DB + localStorage → exactly one import POST, toast, hydrate, and zero echo PUTs', async () => {
    localStorage.setItem('seo-quarter-v3', LOCAL_PAYLOAD)
    const importResponse = {
      plan: { name: 'Quarter plan', startDate: '2026-01-05', slotsPerWeek: 3, layouts: {}, updatedAt: 'x' },
      assignments: [{ clientId: 1, week: 2, position: 0, priority: 1, status: 'on_hold', note: 'ls', completed: false }],
    }
    const f = stubFetch({
      clients: { ok: true, json: DB_CLIENTS },
      planGet: { ok: true, json: { plan: null } },
      importPost: { ok: true, json: importResponse },
    })
    const { result, onToast } = await renderPlan()
    expect(f.imports()).toHaveLength(1)
    expect(onToast).toHaveBeenCalledWith('⬆ Imported quarter plan from this browser')
    expect(result.current.schedule).toEqual({ 2: [1] })
    expect(result.current.canPersist).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(f.puts()).toHaveLength(0) // import success must not echo-save
  })

  it('import 409 → re-GET, DB wins', async () => {
    localStorage.setItem('seo-quarter-v3', LOCAL_PAYLOAD)
    let getCount = 0
    const f = stubFetch({
      clients: { ok: true, json: DB_CLIENTS },
      planGet: { ok: true, json: { plan: null } },
      importPost: { ok: false, status: 409 },
    })
    // second GET (after 409) returns the DB plan
    const orig = global.fetch
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/quarter-plan' && (init?.method ?? 'GET') === 'GET') {
        getCount++
        if (getCount >= 2) return { ok: true, status: 200, json: async () => DB_PLAN } as Response
      }
      return (orig as typeof fetch)(url, init)
    }))
    const { result } = await renderPlan()
    expect(result.current.schedule).toEqual({ 1: [1] }) // DB plan, not localStorage
    expect(result.current.canPersist).toBe(true)
    expect(f.imports()).toHaveLength(1)
  })

  it('import non-409 failure → local data shown read-only, no PUT on later edits', async () => {
    localStorage.setItem('seo-quarter-v3', LOCAL_PAYLOAD)
    const f = stubFetch({
      clients: { ok: true, json: DB_CLIENTS },
      planGet: { ok: true, json: { plan: null } },
      importPost: { ok: false, status: 500 },
    })
    const { result } = await renderPlan()
    expect(result.current.schedule).toEqual({ 2: [1] }) // localStorage rendered
    expect(result.current.canPersist).toBe(false)
    expect(result.current.saveState).toBe('error')
    act(() => result.current.toggleDone(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(f.puts()).toHaveLength(0)
  })

  it('clients fetch fails → canPersist false even when plan GET succeeds', async () => {
    const f = stubFetch({ clients: { ok: false, status: 500 }, planGet: { ok: true, json: { plan: null } } })
    const { result } = await renderPlan()
    expect(result.current.canPersist).toBe(false)
    expect(result.current.clients).toEqual([])
    act(() => result.current.setStartDate('2026-02-02'))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(f.puts()).toHaveLength(0)
  })

  it('plan GET fails → localStorage rendered read-only, no import attempted', async () => {
    localStorage.setItem('seo-quarter-v3', LOCAL_PAYLOAD)
    const f = stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: false } })
    const { result } = await renderPlan()
    expect(result.current.schedule).toEqual({ 2: [1] })
    expect(result.current.canPersist).toBe(false)
    expect(f.imports()).toHaveLength(0)
  })
})

describe('useQuarterPlan persistence', () => {
  beforeEach(() => vi.useFakeTimers())

  it('an edit after load → exactly one PUT after 800ms; saveState saving→saved', async () => {
    const f = stubFetch({
      clients: { ok: true, json: DB_CLIENTS },
      planGet: { ok: true, json: DB_PLAN },
      put: { ok: true },
    })
    const { result } = await renderPlan()
    act(() => result.current.toggleDone(1))
    expect(result.current.saveState).toBe('saving')
    expect(f.puts()).toHaveLength(0) // debounce pending
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(f.puts()).toHaveLength(1)
    expect(result.current.saveState).toBe('saved')
    const body = f.puts()[0].body as { assignments: { clientId: number; completed: boolean }[] }
    expect(body.assignments.find(a => a.clientId === 1)?.completed).toBe(true)
  })

  it('rapid edits collapse into one PUT (debounce restarts)', async () => {
    const f = stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: DB_PLAN }, put: { ok: true } })
    const { result } = await renderPlan()
    act(() => result.current.toggleDone(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    act(() => result.current.setPriority(1, 5))
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(f.puts()).toHaveLength(1)
  })

  it('PUT failure → saveState error + retry toast', async () => {
    const f = stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: DB_PLAN }, put: { ok: false } })
    const { result, onToast } = await renderPlan()
    act(() => result.current.toggleDone(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(result.current.saveState).toBe('error')
    expect(onToast).toHaveBeenCalledWith('⚠ Save failed — will retry on next change')
    expect(f.puts()).toHaveLength(1)
  })

  it('pagehide flushes a pending debounced save with keepalive, and the timer does not double-PUT', async () => {
    const f = stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: DB_PLAN }, put: { ok: true } })
    const keepaliveFlags: (boolean | undefined)[] = []
    const orig = global.fetch
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') keepaliveFlags.push(init.keepalive)
      return (orig as typeof fetch)(url, init)
    }))
    const { result } = await renderPlan()
    act(() => result.current.toggleDone(1))      // debounce pending, no PUT yet
    expect(f.puts()).toHaveLength(0)
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(f.puts()).toHaveLength(1)
    expect(keepaliveFlags).toEqual([true])
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(f.puts()).toHaveLength(1)             // timer was cleared — no second PUT
  })

  it('generation guard: in-flight save A cannot mark "saved" while edit B is pending', async () => {
    let resolveA!: (r: Response) => void
    let putCount = 0
    const f = stubFetch({
      clients: { ok: true, json: DB_CLIENTS },
      planGet: { ok: true, json: DB_PLAN },
      put: () => {
        putCount++
        if (putCount === 1) return new Promise<Response>(r => { resolveA = r })
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
      },
    })
    const { result } = await renderPlan()
    act(() => result.current.toggleDone(1))                       // edit A
    await act(async () => { await vi.advanceTimersByTimeAsync(800) }) // PUT A in flight
    act(() => result.current.setPriority(1, 4))                   // edit B schedules → seq bumps
    await act(async () => { resolveA({ ok: true, status: 200, json: async () => ({}) } as Response) })
    expect(result.current.saveState).toBe('saving')               // A may not claim "saved"
    await act(async () => { await vi.advanceTimersByTimeAsync(800) }) // PUT B fires + resolves
    expect(result.current.saveState).toBe('saved')
    expect(f.puts()).toHaveLength(2)
  })
})

describe('useQuarterPlan derived activity + push metadata (B5)', () => {
  beforeEach(() => vi.useFakeTimers())

  it('populates formatted activity after load', async () => {
    stubFetch({
      clients: { ok: true, json: DB_CLIENTS },
      planGet: { ok: true, json: DB_PLAN },
      activity: { ok: true, json: { activity: { 1: { latest: { kind: 'ada-audit', at: '2026-06-09T12:00:00Z' }, kinds: { 'ada-audit': '2026-06-09T12:00:00Z' } } } } },
    })
    const { result } = await renderPlan()
    for (let i = 0; i < 20 && !result.current.activity[1]; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    }
    expect(result.current.activity[1]).toMatch(/^ADA audit · /)
    expect(result.current.activity[2]).toBeUndefined()
  })

  it('tolerates an activity fetch failure: empty activity, canPersist intact, zero PUTs', async () => {
    const f = stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: DB_PLAN } }) // activity unrouted -> rejects
    const { result } = await renderPlan()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(result.current.activity).toEqual({})
    expect(result.current.canPersist).toBe(true)
    expect(result.current.saveState).toBe('idle')
    expect(f.puts()).toHaveLength(0)
  })

  it('exposes pushMeta from the GET response, null when never pushed', async () => {
    const pushedPlan: QuarterPlanGetResponse = {
      plan: { ...((DB_PLAN as Extract<QuarterPlanGetResponse, { plan: object }>).plan), teamworkPushedAt: '2026-06-10T12:00:00.000Z', teamworkPushSummary: { created: 3, skippedExisting: 0, skippedNoTasklist: 1, skippedCompleted: 0 } },
      assignments: [],
    }
    stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: pushedPlan } })
    const { result } = await renderPlan()
    expect(result.current.pushMeta).toEqual({ pushedAt: '2026-06-10T12:00:00.000Z', summary: { created: 3, skippedExisting: 0, skippedNoTasklist: 1, skippedCompleted: 0 } })
  })
})

describe('useQuarterPlan client mutations', () => {
  beforeEach(() => vi.useFakeTimers())

  it('addClient POSTs, inserts sorted, toasts, returns true', async () => {
    stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: { plan: null } }, put: { ok: true } })
    const orig = global.fetch
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/clients' && init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ id: 9, name: 'Aardvark U' }) } as Response
      }
      return (orig as typeof fetch)(url, init)
    }))
    const { result, onToast } = await renderPlan()
    let ok = false
    await act(async () => { ok = await result.current.addClient('Aardvark U') })
    expect(ok).toBe(true)
    expect(result.current.clients[0]).toMatchObject({ id: 9, name: 'Aardvark U', priority: 3, status: 'not_started', note: '' })
    expect(onToast).toHaveBeenCalledWith('+ Added "Aardvark U"')
  })

  it('removeClient optimistically drops the client and ARCHIVES it (no DELETE — that 409s post-B5)', async () => {
    stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: DB_PLAN }, put: { ok: true } })
    const orig = global.fetch
    const patches: { url: string; body: unknown }[] = []
    const deletes: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patches.push({ url, body: JSON.parse(init.body as string) })
        return { ok: true, status: 200, json: async () => ({}) } as Response
      }
      if (init?.method === 'DELETE') { deletes.push(url); return { ok: true, status: 200, json: async () => ({}) } as Response }
      return (orig as typeof fetch)(url, init)
    }))
    const { result } = await renderPlan()
    act(() => result.current.removeClient(1))
    expect(result.current.clients.find(c => c.id === 1)).toBeUndefined()
    expect(result.current.schedule[1] ?? []).not.toContain(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(patches).toEqual([{ url: '/api/clients/1', body: { archived: true } }])
    expect(deletes).toEqual([])
  })

  it('assignHoveredToFrontier places the chip, toasts the week, returns the next pool id', async () => {
    stubFetch({ clients: { ok: true, json: DB_CLIENTS }, planGet: { ok: true, json: { plan: null } }, put: { ok: true } })
    const { result, onToast } = await renderPlan()
    let next: number | null = null
    act(() => { next = result.current.assignHoveredToFrontier(1) })
    expect(result.current.schedule[1]).toContain(1)
    expect(onToast).toHaveBeenCalledWith('→ Wk 1')
    expect(next).toBe(2)
  })
})
