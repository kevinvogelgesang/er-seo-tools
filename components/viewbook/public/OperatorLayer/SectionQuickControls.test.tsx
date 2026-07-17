// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { OperatorSectionData } from '@/lib/viewbook/operator-data'
import { requestRefresh } from '../useViewbookSync'
import { SectionQuickControls } from './SectionQuickControls'

vi.mock('../useViewbookSync', async () => {
  const actual = await vi.importActual<typeof import('../useViewbookSync')>('../useViewbookSync')
  return { ...actual, requestRefresh: vi.fn() }
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
