// @vitest-environment jsdom
import crypto from 'crypto'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { prisma } from '@/lib/db'
import type { OperatorSectionData } from '@/lib/viewbook/operator-data'
import { ACKABLE_SECTION_KEYS, acknowledgeSection } from '@/lib/viewbook/ack'
import { loadViewbookPublicData } from '@/lib/viewbook/public-data'
import { createViewbook } from '@/lib/viewbook/service'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { buildTocIndex } from '@/lib/viewbook/toc-index'
import { requestRefresh } from '../useViewbookSync'
import { SectionQuickControls } from './SectionQuickControls'

vi.mock('../useViewbookSync', async () => {
  const actual = await vi.importActual<typeof import('../useViewbookSync')>('../useViewbookSync')
  return { ...actual, requestRefresh: vi.fn() }
})

vi.mock('@/lib/jobs/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/queue')>()
  return { ...actual, enqueueJob: vi.fn(async () => ({ id: 'mock-job', deduped: false })) }
})

const INTEGRATION_PREFIX = 'vb-l3-ack-flow-'

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: INTEGRATION_PREFIX } } })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.mocked(requestRefresh).mockClear()
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

  it('resets an acknowledged ackable section with DELETE', async () => {
    const [url, init] = await clickAndRead(
      'Reset ack',
      section({ sectionKey: 'pc-setup', acknowledgedAt: '2026-07-16T00:00:00.000Z' }),
    )
    expect(url).toBe('/api/viewbooks/8/ack/pc-setup')
    expect(init.method).toBe('DELETE')
    expect(requestRefresh).toHaveBeenCalledOnce()
  })

  it('shows Reset ack only for acknowledged ackable sections', () => {
    render(<SectionQuickControls viewbookId={8} section={section()} pcCompletedAt={null} />)
    expect(screen.queryByRole('button', { name: 'Reset ack' })).toBeNull()
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
})
