// lib/ada-audit/browser-pool.test.ts
//
// Pool semantics only — puppeteer is mocked. Uses vi.resetModules() so each
// test gets fresh module state (slots, counters, gate).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const newPageMock = () => ({
  setDefaultTimeout: vi.fn(),
  setCacheEnabled: vi.fn(async () => undefined),
  setBypassServiceWorker: vi.fn(async () => undefined),
  setExtraHTTPHeaders: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
})

let launchCount = 0
const makeBrowser = () => {
  const b = {
    connected: true,
    newPage: vi.fn(async () => newPageMock()),
    close: vi.fn(async () => { b.connected = false }),
    on: vi.fn(),
  }
  return b
}

const launchMock = vi.fn(async () => {
  launchCount++
  return makeBrowser()
})

vi.mock('puppeteer-core', () => ({
  default: { launch: launchMock },
}))

async function loadPool(env: { recycle?: string; pool?: string } = {}) {
  vi.resetModules()
  process.env.SITE_AUDIT_BROWSER_RECYCLE_PAGES = env.recycle ?? '3'
  process.env.BROWSER_POOL_SIZE = env.pool ?? '2'
  return import('./browser-pool')
}

describe('browser-pool recycle gate + idle close', () => {
  beforeEach(() => {
    launchCount = 0
    launchMock.mockClear()
    vi.useRealTimers()
  })

  it('recycles Chrome after N pages served, waking waiters on a fresh browser', async () => {
    const pool = await loadPool({ recycle: '2', pool: '2' })
    const p1 = await pool.acquirePage()
    const p2 = await pool.acquirePage() // pagesServed = 2 = threshold
    expect(launchCount).toBe(1)

    // Third acquire must wait behind the drain gate.
    let acquired = false
    const pending = pool.acquirePage().then((p) => { acquired = true; return p })
    await new Promise((r) => setTimeout(r, 20))
    expect(acquired).toBe(false)

    await pool.releasePage(p1)
    await new Promise((r) => setTimeout(r, 20))
    expect(acquired).toBe(false) // one page still active — gate holds

    await pool.releasePage(p2)
    const p3 = await pending // gate released after recycle
    expect(acquired).toBe(true)
    expect(launchCount).toBe(2) // fresh Chrome
    await pool.releasePage(p3)
  })

  it('does not recycle below the threshold', async () => {
    const pool = await loadPool({ recycle: '10', pool: '2' })
    const p1 = await pool.acquirePage()
    await pool.releasePage(p1)
    const p2 = await pool.acquirePage()
    await pool.releasePage(p2)
    expect(launchCount).toBe(1)
  })

  it('gates at acquire time: threshold below pool capacity holds the next acquirer', async () => {
    const pool = await loadPool({ recycle: '1', pool: '4' })
    const p1 = await pool.acquirePage() // pagesServed=1 = threshold → gate set
    let acquired = false
    const pending = pool.acquirePage().then((p) => { acquired = true; return p })
    await new Promise((r) => setTimeout(r, 20))
    expect(acquired).toBe(false) // slots were free, but the gate holds
    await pool.releasePage(p1) // recycles (all pages back) → gate opens
    const p2 = await pending
    expect(launchCount).toBe(2)
    await pool.releasePage(p2)
  })

  it('restores the slot when browser launch fails', async () => {
    const pool = await loadPool({ recycle: '100', pool: '1' })
    launchMock.mockRejectedValueOnce(new Error('no chrome'))
    await expect(pool.acquirePage()).rejects.toThrow('no chrome')
    // Slot must be back — next acquire succeeds on the recovered mock.
    const p = await pool.acquirePage()
    await pool.releasePage(p)
  })

  it('idle close: closes Chrome after the idle delay, cancelled by a new acquire', async () => {
    vi.useFakeTimers()
    const pool = await loadPool({ recycle: '100', pool: '2' })
    const p1 = await pool.acquirePage()
    await pool.releasePage(p1)
    // Pool fully idle — idle timer armed. Acquire again before it fires.
    await vi.advanceTimersByTimeAsync(30_000)
    const p2 = await pool.acquirePage()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(launchCount).toBe(1) // timer was cancelled; same browser
    await pool.releasePage(p2)
    await vi.advanceTimersByTimeAsync(120_000)
    const p3 = await pool.acquirePage() // after idle close, relaunches
    expect(launchCount).toBe(2)
    await pool.releasePage(p3)
  })

  it('external closeBrowser releases the gate and leaves no waiter stuck', async () => {
    const pool = await loadPool({ recycle: '1', pool: '1' })
    const p1 = await pool.acquirePage() // threshold hit immediately
    let acquired = false
    const pending = pool.acquirePage().then((p) => { acquired = true; return p })
    await new Promise((r) => setTimeout(r, 20))
    expect(acquired).toBe(false)
    await pool.releasePage(p1) // recycle path runs, gate opens
    const p2 = await pending
    expect(acquired).toBe(true)
    // Now park another waiter on the slot and call closeBrowser directly.
    const pending2 = pool.acquirePage()
    await pool.closeBrowser() // must not deadlock the waiter
    await pool.releasePage(p2)
    const p3 = await pending2
    await pool.releasePage(p3)
    expect(true).toBe(true) // reaching here = no deadlock
  })
})

describe('getPoolState (A4)', () => {
  it('reports initial idle state with no browser', async () => {
    const pool = await loadPool({ pool: '2' })
    expect(pool.getPoolState()).toEqual({
      poolSize: 2, inUse: 0, free: 2, waiting: 0,
      draining: false, browserAlive: false, pagesServed: 0,
    })
  })

  it('reflects an acquired page and a live browser', async () => {
    const pool = await loadPool({ pool: '2' })
    const page = await pool.acquirePage()
    const s = pool.getPoolState()
    expect(s.inUse).toBe(1)
    expect(s.free).toBe(1)
    expect(s.browserAlive).toBe(true) // mock browser.connected === true
    expect(s.pagesServed).toBe(1)
    await pool.releasePage(page)
    expect(pool.getPoolState().inUse).toBe(0)
  })
})

describe('browser-pool cancellable acquire (Codex fix 3)', () => {
  beforeEach(() => { launchCount = 0; launchMock.mockClear(); vi.useRealTimers() })

  it('an already-aborted signal rejects without taking a slot', async () => {
    const pool = await loadPool({ pool: '2' })
    const ac = new AbortController(); ac.abort()
    await expect(pool.acquirePage({ signal: ac.signal })).rejects.toBeInstanceOf(pool.AcquireAbortedError)
    expect(pool.getPoolState().free).toBe(2) // no slot consumed
  })

  it('aborting a parked waiter frees no slot and does not block later acquirers', async () => {
    const pool = await loadPool({ pool: '1', recycle: '999' })
    const p1 = await pool.acquirePage()               // pool now full (1 slot)
    const ac = new AbortController()
    const parked = pool.acquirePage({ signal: ac.signal })
    const rejected = expect(parked).rejects.toBeInstanceOf(pool.AcquireAbortedError)
    ac.abort()
    await rejected
    await pool.releasePage(p1)                          // frees the slot
    const p2 = await pool.acquirePage()                 // must proceed — no leak from the aborted waiter
    expect(p2).toBeTruthy()
    expect(pool.getPoolState().inUse).toBe(1)
  })

  it('a waiter woken by a release but aborted in the same tick does NOT get a slot', async () => {
    const pool = await loadPool({ pool: '1', recycle: '999' })
    const p1 = await pool.acquirePage()                 // pool full
    const ac = new AbortController()
    const parked = pool.acquirePage({ signal: ac.signal })
    const rejected = expect(parked).rejects.toBeInstanceOf(pool.AcquireAbortedError)
    // Release (wakes the parked waiter) and abort in the same microtask turn.
    void pool.releasePage(p1)
    ac.abort()
    await rejected
    expect(pool.getPoolState().free).toBe(1)            // freed slot NOT consumed by the aborted waiter
    expect(pool.getPoolState().pagesServed).toBe(1)     // only p1 ever served
  })
})
