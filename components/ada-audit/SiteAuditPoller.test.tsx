// @vitest-environment jsdom
import { render, screen, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import SiteAuditPoller from './SiteAuditPoller'

const refresh = vi.fn()
const replace = vi.fn()
// One STABLE router object — a fresh object per useRouter() call would churn
// the hook's `router` effect dependency and restart the interval every render.
const router = { refresh, replace }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

function makeFetch() {
  const pending: Array<{ resolve: (v: { ok: boolean; body?: unknown }) => void }> = []
  const fn = vi.fn(
    () =>
      new Promise((resolve) => {
        pending.push({ resolve: (v) => resolve({ ok: v.ok, json: async () => v.body } as Response) })
      }),
  )
  return {
    fn,
    async resolveNext(v: { ok: boolean; body?: unknown }) {
      const p = pending.shift()
      if (!p) throw new Error('no pending fetch')
      await act(async () => {
        p.resolve(v)
        await flushAsync()
      })
    },
  }
}

// Minimal poll payload — counters zero (seoOnly audits have no pdf/LH work).
const poll = (over: Record<string, unknown> = {}) => ({
  status: 'running',
  pagesTotal: 4, pagesComplete: 1, pagesError: 0,
  queuePosition: null, activeAudit: null,
  ...over,
})

beforeEach(() => {
  vi.useFakeTimers()
  refresh.mockClear()
  replace.mockClear()
})
afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SiteAuditPoller seoOnly', () => {
  it('renders the verifier phase when parent completes without a run (no dead gap, no navigation)', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    render(
      <SiteAuditPoller id="s1" seoOnly initialStatus="running"
        initialPagesTotal={4} initialPagesComplete={1} initialPagesError={0} />,
    )
    await vi.advanceTimersByTimeAsync(3000)
    await f.resolveNext({ ok: true, body: poll({
      status: 'complete', pagesComplete: 4, seoOnly: true, liveScanRunId: null,
      seoPhase: { state: 'running', progress: 40, message: 'Checking links…' },
    }) })
    expect(screen.getByText('SEO analysis running')).toBeTruthy()
    expect(screen.getByText('Checking links…')).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('navigates to the run page exactly once when the run lands, without refresh', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    render(
      <SiteAuditPoller id="s1" seoOnly initialStatus="complete"
        initialLiveScanRunId={null}
        initialSeoPhase={{ state: 'running', progress: 80, message: 'Building results…' }}
        initialPagesTotal={4} initialPagesComplete={4} initialPagesError={0} />,
    )
    await vi.advanceTimersByTimeAsync(3000)
    await f.resolveNext({ ok: true, body: poll({
      status: 'complete', pagesComplete: 4, seoOnly: true, liveScanRunId: 'run9',
      seoPhase: { state: 'done', progress: null, message: null },
    }) })
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/seo-audits/results/run/run9')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('mounted with a failed phase is inert (no fetch) and shows the failed banner', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    render(
      <SiteAuditPoller id="s1" seoOnly initialStatus="complete"
        initialLiveScanRunId={null}
        initialSeoPhase={{ state: 'failed', progress: null, message: null }}
        initialPagesTotal={4} initialPagesComplete={4} initialPagesError={0} />,
    )
    await vi.advanceTimersByTimeAsync(6000)
    expect(f.fn).not.toHaveBeenCalled()
    expect(screen.getByText('SEO analysis failed')).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('failed phase reached VIA polling refreshes once (server re-renders the static failed banner)', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    render(
      <SiteAuditPoller id="s1" seoOnly initialStatus="complete"
        initialLiveScanRunId={null}
        initialSeoPhase={{ state: 'queued', progress: null, message: null }}
        initialPagesTotal={4} initialPagesComplete={4} initialPagesError={0} />,
    )
    await vi.advanceTimersByTimeAsync(3000)
    await f.resolveNext({ ok: true, body: poll({
      status: 'complete', pagesComplete: 4, seoOnly: true, liveScanRunId: null,
      seoPhase: { state: 'failed', progress: null, message: null },
    }) })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('SiteAuditPoller non-seoOnly (regression)', () => {
  it('complete is terminal → one refresh, no replace', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    render(
      <SiteAuditPoller id="s2" initialStatus="running"
        initialPagesTotal={4} initialPagesComplete={3} initialPagesError={0} />,
    )
    await vi.advanceTimersByTimeAsync(3000)
    await f.resolveNext({ ok: true, body: poll({ status: 'complete', pagesComplete: 4 }) })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalled()
  })
})
