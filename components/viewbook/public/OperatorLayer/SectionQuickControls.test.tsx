// @vitest-environment jsdom
import crypto from 'crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { prisma } from '@/lib/db'
import type { OperatorSectionData } from '@/lib/viewbook/operator-data'
import type { SectionKey } from '@/lib/viewbook/theme'
import { ACKABLE_SECTION_KEYS, acknowledgeSection as acknowledgeSectionCore } from '@/lib/viewbook/ack'
import { loadViewbookPublicData } from '@/lib/viewbook/public-data'
import { createViewbook } from '@/lib/viewbook/service'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { buildTocIndex } from '@/lib/viewbook/toc-index'
import { navigateToAnchor } from '@/components/viewbook/public/viewbook-navigate'
import { __resetSyncRegistry, hasActiveEditorActivity, requestRefresh } from '../useViewbookSync'
import { SelectionProvider, useSelectionContext, type SelectionState } from './inspector/SelectionContext'
import { SectionActivityProvider, useSectionActivityContext } from './inspector/useSectionActivity'
import { SectionQuickControls } from './SectionQuickControls'

vi.mock('../useViewbookSync', async () => {
  const actual = await vi.importActual<typeof import('../useViewbookSync')>('../useViewbookSync')
  return { ...actual, requestRefresh: vi.fn() }
})

vi.mock('@/components/viewbook/public/viewbook-navigate', () => ({ navigateToAnchor: vi.fn() }))

vi.mock('@/lib/jobs/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/queue')>()
  return { ...actual, enqueueJob: vi.fn(async () => ({ id: 'mock-job', deduped: false })) }
})

const INTEGRATION_PREFIX = 'vb-l3-ack-flow-'
const LEGACY_TEST_AUTH = { principal: { kind: 'operator', email: 'client' } } as const

function acknowledgeSection(...args: [Parameters<typeof acknowledgeSectionCore>[0], Parameters<typeof acknowledgeSectionCore>[1], Parameters<typeof acknowledgeSectionCore>[2]]) {
  return acknowledgeSectionCore(args[0], args[1], args[2], LEGACY_TEST_AUTH)
}

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: INTEGRATION_PREFIX } } })
})

// The Reset-ack DELETE is now confirm-gated (fix #12). Default the confirm to
// accept so the existing happy-path assertions still exercise the mutation; the
// CANCEL-path test overrides this stub to reject.
beforeEach(() => {
  vi.stubGlobal('confirm', () => true)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.mocked(requestRefresh).mockClear()
  vi.mocked(navigateToAnchor).mockClear()
  __resetSyncRegistry()
})

function section(overrides: Partial<OperatorSectionData> = {}): OperatorSectionData {
  return {
    sectionKey: 'data-source',
    state: 'active',
    doneAt: null,
    acknowledgedAt: null,
    introNote: null,
    narrative: null,
    ...overrides,
  }
}

function ok() {
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}

async function clickAndRead(name: string, row: OperatorSectionData) {
  const fetchMock = vi.fn().mockResolvedValue(ok())
  vi.stubGlobal('fetch', fetchMock)
  render(<SectionQuickControls viewbookId={8} section={row} pcCompletedAt="2026-07-16T00:00:00.000Z" />)
  fireEvent.click(screen.getByRole('button', { name }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
  return fetchMock.mock.calls[0]
}

describe('SectionQuickControls', () => {
  it('renders a readable title, dark-aware neutral rail, and semantic state pills', () => {
    const { container } = render(
      <SectionQuickControls
        viewbookId={8}
        section={section({ sectionKey: 'pc-setup', acknowledgedAt: '2026-07-16T00:00:00.000Z' })}
        pcCompletedAt={null}
      />,
    )
    const rail = container.querySelector('[data-operator-section-controls]')
    expect(screen.getByText('Editing section')).toBeTruthy()
    expect(screen.getByText('Set Up Your Onboarding Viewbook')).toBeTruthy()
    expect(screen.queryByText('pc-setup')).toBeNull()
    expect(screen.getByText('Visible')).toBeTruthy()
    expect(screen.getByText('Acknowledged')).toBeTruthy()
    expect(rail?.getAttribute('class')).toContain('border-gray-200')
    expect(rail?.getAttribute('class')).toContain('dark:bg-navy-deep/95')
  })

  it('renders hidden and complete states with semantic pills', () => {
    render(<SectionQuickControls viewbookId={8} section={section({ state: 'hidden' })} pcCompletedAt={null} />)
    expect(screen.getByText('Hidden')).toBeTruthy()
    cleanup()
    render(<SectionQuickControls viewbookId={8} section={section({ state: 'done' })} pcCompletedAt={null} />)
    expect(screen.getByText('Complete')).toBeTruthy()
  })

  it('supports a compact embedded variant without the full-width rail chrome', () => {
    const { container } = render(
      <SectionQuickControls
        viewbookId={8}
        section={section({ sectionKey: 'strategy', state: 'hidden' })}
        pcCompletedAt={null}
        variant="embedded"
      />,
    )
    const controls = container.querySelector('[data-operator-section-controls]')
    expect(controls?.getAttribute('data-operator-section-controls-variant')).toBe('embedded')
    expect(controls?.getAttribute('class')).not.toContain('border-y')
    expect(screen.getByText('SEO, GEO & E-E-A-T Strategy')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show' })).toBeTruthy()
  })

  it('shows live busy feedback and disables the entire action group during a mutation', async () => {
    let resolveFetch!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve })))
    render(
      <SectionQuickControls
        viewbookId={8}
        section={section({ sectionKey: 'pc-setup', acknowledgedAt: '2026-07-16T00:00:00.000Z' })}
        pcCompletedAt={null}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(await screen.findByText('Updating section…')).toBeTruthy()
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true)

    resolveFetch(ok())
    await waitFor(() => expect(screen.queryByText('Updating section…')).toBeNull())
  })

  it('hides and shows through the section PATCH contract', async () => {
    let [url, init] = await clickAndRead('Hide', section())
    expect(url).toBe('/api/viewbooks/8/sections/data-source')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ state: 'hidden' })
    cleanup()
    vi.unstubAllGlobals()

    ;[url, init] = await clickAndRead('Show', section({ state: 'hidden' }))
    expect(JSON.parse(init.body)).toEqual({ state: 'active' })
  })

  it('marks done and reopens only done-capable sections', async () => {
    let [, init] = await clickAndRead('Mark done', section())
    expect(JSON.parse(init.body)).toEqual({ state: 'done' })
    cleanup()
    vi.unstubAllGlobals()

    ;[, init] = await clickAndRead('Reopen', section({ state: 'done' }))
    expect(JSON.parse(init.body)).toEqual({ state: 'active' })
  })

  // PR1 (viewbook viewer-collapse): 'collapsed' is retired from the state
  // enum. Shared collapse (the orthogonal collapsedShared boolean,
  // lib/viewbook/collapse.ts PR2) went DORMANT in the 2026-07-19 local-only
  // revision — the operator Collapse/Expand controls that used to PATCH
  // state:'collapsed' are gone; the viewer's in-hero control is now purely
  // local (localStorage), never a PATCH. No section (bookend or otherwise)
  // exposes a Collapse/Expand button here any more.
  it('never exposes a Collapse or Expand control, on any section', () => {
    for (const sectionKey of ['data-source', 'pc-setup', 'milestones', 'materials', 'welcome', 'strategy', 'pc-intro'] as const) {
      render(<SectionQuickControls viewbookId={8} section={section({ sectionKey })} pcCompletedAt={null} />)
      expect(screen.queryByRole('button', { name: 'Collapse' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Expand' })).toBeNull()
      cleanup()
    }
  })

  it('resets an acknowledged ackable section with DELETE', async () => {
    const [url, init] = await clickAndRead(
      'Reset ack',
      section({ sectionKey: 'pc-setup', acknowledgedAt: '2026-07-16T00:00:00.000Z' }),
    )
    expect(url).toBe('/api/viewbooks/8/ack/pc-setup')
    expect(init.method).toBe('DELETE')
    expect(requestRefresh).toHaveBeenCalledOnce()
  })

  // Regression: the status controls are discrete mutations with no draft to
  // protect, so merely HOLDING focus must not register shared editor activity.
  // Before the fix they registered `busy || focus.focused`; because Reset-ack
  // unmounts its own focused button (acknowledgedAt → null), the container's
  // onBlur never fires, focus.focused sticks true, the shared refresher stays
  // non-idle forever, and the deferred requestRefresh() never lands — the reset
  // "needs a reload" and blocks every later reset (page-global registry).
  it('does not wedge the shared refresher merely by holding focus on the controls', () => {
    render(
      <SectionQuickControls
        viewbookId={8}
        section={section({ sectionKey: 'pc-setup', acknowledgedAt: '2026-07-16T00:00:00.000Z' })}
        pcCompletedAt={null}
      />,
    )
    fireEvent.focusIn(screen.getByRole('button', { name: 'Reset ack' }))
    expect(hasActiveEditorActivity()).toBe(false)
  })

  it('leaves the shared refresher idle after an ack reset so the refresh lands without a reload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    render(
      <SectionQuickControls
        viewbookId={8}
        section={section({ sectionKey: 'pc-setup', acknowledgedAt: '2026-07-16T00:00:00.000Z' })}
        pcCompletedAt={null}
      />,
    )
    const resetBtn = screen.getByRole('button', { name: 'Reset ack' })
    fireEvent.focusIn(resetBtn) // operator focuses the control before clicking
    fireEvent.click(resetBtn)
    await waitFor(() => expect(requestRefresh).toHaveBeenCalledOnce())
    // The Reset-ack button has unmounted (optimistic acknowledgedAt → null) while
    // focused; the registry MUST still return to idle so the held refresh flushes.
    await waitFor(() => expect(hasActiveEditorActivity()).toBe(false))
  })

  it('shows Reset ack only for acknowledged ackable sections', () => {
    render(<SectionQuickControls viewbookId={8} section={section()} pcCompletedAt={null} />)
    expect(screen.queryByRole('button', { name: 'Reset ack' })).toBeNull()
    cleanup()
    render(
      <SectionQuickControls
        viewbookId={8}
        section={section({ sectionKey: 'pc-setup', acknowledgedAt: '2026-07-16T00:00:00.000Z' })}
        pcCompletedAt={null}
      />,
    )
    expect(screen.getByRole('button', { name: 'Reset ack' }).getAttribute('class')).toContain('dark:bg-amber-500/10')
    cleanup()
    render(
      <SectionQuickControls
        viewbookId={8}
        section={section({ sectionKey: 'assessment', acknowledgedAt: '2026-07-16T00:00:00.000Z' })}
        pcCompletedAt={null}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Reset ack' })).toBeNull()
  })

  it('persists each of the three acknowledgments through public data, reset controls, TOC state, and honest thanks gating', async () => {
    const client = await prisma.client.create({
      data: { name: `${INTEGRATION_PREFIX}${crypto.randomUUID()}` },
    })
    const created = await createViewbook(client.id, 'upgrade', 'operator@example.com')
    const viewbook = await requireViewbookToken(created.token)

    for (const [index, sectionKey] of ACKABLE_SECTION_KEYS.entries()) {
      await acknowledgeSection(viewbook, created.token, {
        sectionKey,
        clientMutationId: crypto.randomUUID(),
      })

      const data = await loadViewbookPublicData(created.token)
      expect(data).not.toBeNull()
      const publicSection = data?.primarySections.find((candidate) => candidate.sectionKey === sectionKey)
      expect(publicSection?.acknowledgedAt).not.toBeNull()
      expect(buildTocIndex(data!).find((entry) => entry.sectionKey === sectionKey)?.acked).toBe(true)
      expect(data?.primarySections.some((candidate) => candidate.sectionKey === 'pc-thanks')).toBe(index === 2)

      render(
        <SectionQuickControls
          viewbookId={created.id}
          section={section({
            sectionKey,
            state: publicSection?.state ?? 'active',
            doneAt: publicSection?.doneAt ?? null,
            acknowledgedAt: publicSection?.acknowledgedAt ?? null,
          })}
          pcCompletedAt={data?.pcCompletedAt ?? null}
        />,
      )
      expect(screen.getByRole('button', { name: 'Reset ack' })).toBeDefined()
      cleanup()
    }
  })

  it('never exposes done or ack controls on pc-intro and hides pc-thanks controls before completion', () => {
    render(
      <SectionQuickControls
        viewbookId={8}
        section={section({ sectionKey: 'pc-intro', acknowledgedAt: '2026-07-16T00:00:00.000Z' })}
        pcCompletedAt={null}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reset ack' })).toBeNull()
    cleanup()

    const { container } = render(
      <SectionQuickControls viewbookId={8} section={section({ sectionKey: 'pc-thanks' })} pcCompletedAt={null} />,
    )
    expect(container.querySelector('[data-operator-section-controls]')).toBeNull()
  })

  // Fix #12: the ack reset is destructive — a cancelled confirm must fire nothing.
  it('does NOT fire the ack DELETE when the Reset-ack confirm is cancelled', () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', () => false)
    render(
      <SectionQuickControls
        viewbookId={8}
        section={section({ sectionKey: 'pc-setup', acknowledgedAt: '2026-07-16T00:00:00.000Z' })}
        pcCompletedAt={null}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reset ack' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(requestRefresh).not.toHaveBeenCalled()
    // The acknowledged pill is untouched — the optimistic clear never ran.
    expect(screen.getByText('Acknowledged')).toBeTruthy()
  })

  // Fix #10: a status mutation must pin THIS section in the Context-Lens
  // per-section activity registry (so the outline/pane follow it).
  it('reports per-section activity while a Hide mutation is in flight', async () => {
    let resolveFetch!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve })))

    function ActivityProbe({ sectionKey }: { sectionKey: SectionKey }) {
      const activity = useSectionActivityContext()
      return <span data-testid="activity">{activity.anyActive(sectionKey) ? 'active' : 'idle'}</span>
    }

    render(
      <SelectionProvider>
        <SectionActivityProvider>
          <SectionQuickControls viewbookId={8} section={section({ sectionKey: 'strategy' })} pcCompletedAt={null} />
          <ActivityProbe sectionKey="strategy" />
        </SectionActivityProvider>
      </SelectionProvider>,
    )
    expect(screen.getByTestId('activity').textContent).toBe('idle')

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    await waitFor(() => expect(screen.getByTestId('activity').textContent).toBe('active'))

    resolveFetch(ok())
    await waitFor(() => expect(screen.getByTestId('activity').textContent).toBe('idle'))
  })

  // PR5 Task 1 regression: a discrete mutation button that unmounts itself
  // while still focused (Reset-ack: the button disappears the moment
  // acknowledgedAt optimistically clears) must NOT strand a hard activity pin
  // on its section forever. Before the fix, `useReportSectionActivity` reported
  // `focused: focus.focused`, which stuck `true` past the unmount (no blur ever
  // fires for a removed element) -> a PERMANENT hard pin -> every other
  // section's `select()` fails closed. This asserts the full lifecycle: pinned
  // while busy, released once the mutation settles even though the focused
  // button unmounted, and a DIFFERENT section becomes selectable again.
  it('a discrete mutation pins its section while busy, releases after settle even when the focused button unmounts, then a different section is selectable', async () => {
    let resolveFetch!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve })))

    let latestSelect: SelectionState['select'] = () => false
    function SelectProbe() {
      const selection = useSelectionContext()
      latestSelect = selection.select
      return null
    }
    function ActivityProbe({ sectionKey }: { sectionKey: SectionKey }) {
      const activity = useSectionActivityContext()
      const agg = activity.aggregateFor(sectionKey)
      return (
        <span data-testid={`activity-${sectionKey}`}>
          {JSON.stringify({ busy: agg.busy, any: activity.anyActive(sectionKey) })}
        </span>
      )
    }

    render(
      <SelectionProvider>
        <SectionActivityProvider>
          <SectionQuickControls
            viewbookId={8}
            section={section({ sectionKey: 'pc-setup', acknowledgedAt: '2026-07-16T00:00:00.000Z' })}
            pcCompletedAt={null}
          />
          <SectionQuickControls viewbookId={8} section={section({ sectionKey: 'strategy' })} pcCompletedAt={null} />
          <ActivityProbe sectionKey="pc-setup" />
          <SelectProbe />
        </SectionActivityProvider>
      </SelectionProvider>,
    )

    const readActivity = (sectionKey: string) =>
      JSON.parse(screen.getByTestId(`activity-${sectionKey}`).textContent!) as { busy: boolean; any: boolean }

    const resetBtn = screen.getByRole('button', { name: 'Reset ack' })
    fireEvent.focusIn(resetBtn) // operator focuses the control before clicking
    fireEvent.click(resetBtn)

    // (1) While the DELETE is in flight, pc-setup IS pinned (busy).
    await waitFor(() => expect(readActivity('pc-setup').busy).toBe(true))
    expect(readActivity('pc-setup').any).toBe(true)

    resolveFetch(ok())
    await waitFor(() => expect(requestRefresh).toHaveBeenCalledOnce())
    // The Reset-ack button has unmounted (optimistic acknowledgedAt -> null)
    // while still focused.
    expect(screen.queryByRole('button', { name: 'Reset ack' })).toBeNull()

    // (2) The pin releases even though the focused button unmounted.
    await waitFor(() => expect(readActivity('pc-setup').any).toBe(false))

    // (3) A different section is now selectable -- not fails-closed.
    expect(latestSelect('strategy')).toBe(true)
  })

  // Fix #11: post-Show navigation fires ONCE, only after the refreshed prop
  // state flips hidden→active (i.e. the section is back in the canvas), never
  // while still hidden, and never twice.
  it('navigates to the section anchor only after a Show refresh flips state hidden→active', () => {
    const { rerender } = render(
      <SectionQuickControls viewbookId={8} section={section({ sectionKey: 'strategy', state: 'hidden' })} pcCompletedAt={null} />,
    )
    expect(navigateToAnchor).not.toHaveBeenCalled()

    // The optimistic Show + refresh lands: the parent re-renders this pane with
    // the now-active section prop.
    rerender(
      <SectionQuickControls viewbookId={8} section={section({ sectionKey: 'strategy', state: 'active' })} pcCompletedAt={null} />,
    )
    expect(navigateToAnchor).toHaveBeenCalledWith('strategy', '#strategy')
    expect(navigateToAnchor).toHaveBeenCalledTimes(1)

    // A subsequent unrelated re-render (still active) does not re-fire.
    rerender(
      <SectionQuickControls viewbookId={8} section={section({ sectionKey: 'strategy', state: 'active' })} pcCompletedAt={null} />,
    )
    expect(navigateToAnchor).toHaveBeenCalledTimes(1)
  })

  it('does NOT navigate on a static hidden render (no false Show)', () => {
    const { rerender } = render(
      <SectionQuickControls viewbookId={8} section={section({ sectionKey: 'strategy', state: 'hidden' })} pcCompletedAt={null} />,
    )
    rerender(
      <SectionQuickControls viewbookId={8} section={section({ sectionKey: 'strategy', state: 'hidden' })} pcCompletedAt={null} />,
    )
    expect(navigateToAnchor).not.toHaveBeenCalled()
  })

  // Single-owner recovery flow: a hidden section's pane exposes the ONE Show
  // controller (embedded variant), reachable after the outline selects it.
  it('exposes a Show control for a hidden section in the embedded pane variant (single owner)', () => {
    render(
      <SectionQuickControls
        viewbookId={8}
        section={section({ sectionKey: 'strategy', state: 'hidden' })}
        pcCompletedAt={null}
        variant="embedded"
      />,
    )
    expect(screen.getByRole('button', { name: 'Show' })).toBeTruthy()
  })
})
