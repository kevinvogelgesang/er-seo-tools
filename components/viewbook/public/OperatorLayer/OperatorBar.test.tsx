// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { PresentationModeProvider, PresentationToggle } from '../PresentationToggle'
import { requestRefresh } from '../useViewbookSync'
import { OperatorBar } from './OperatorBar'

vi.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button" aria-label="Toggle ER theme">Theme</button>,
}))

vi.mock('../useViewbookSync', async () => {
  const actual = await vi.importActual<typeof import('../useViewbookSync')>('../useViewbookSync')
  return { ...actual, requestRefresh: vi.fn() }
})

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.mocked(requestRefresh).mockClear()
})

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('OperatorBar', () => {
  it('renders no operator bar before presentation mode initializes or while presenting', async () => {
    const preInitHtml = renderToString(
      <PresentationModeProvider>
        <OperatorBar viewbookId={42} operatorEmail="operator@example.com" stage="kickoff" pcCompletedAt={null} />
      </PresentationModeProvider>,
    )
    expect(preInitHtml).not.toContain('vb-operator-bar')

    vi.stubGlobal('localStorage', {
      getItem: () => 'true',
      setItem: vi.fn(),
    })
    const { container } = render(
      <PresentationModeProvider>
        <OperatorBar viewbookId={42} operatorEmail="operator@example.com" stage="kickoff" pcCompletedAt={null} />
        <PresentationToggle />
      </PresentationModeProvider>,
    )
    await screen.findByRole('button', { name: 'Return to editing' })
    expect(container.querySelector('#vb-operator-bar')).toBeNull()
  })

  it('renders app-styled metadata, stage, theme, presentation, and stage controls', async () => {
    const { container } = render(
      <PresentationModeProvider>
        <OperatorBar viewbookId={42} operatorEmail="operator@example.com" stage="kickoff" pcCompletedAt={null} />
      </PresentationModeProvider>,
    )
    const stage = await screen.findByText('Kickoff')
    const bar = container.querySelector('#vb-operator-bar')
    const advance = screen.getByRole('button', { name: 'Advance' })
    const rollback = screen.getByRole('button', { name: 'Roll back' })
    expect(bar?.getAttribute('class')).toContain('sticky top-0')
    expect(bar?.getAttribute('class')).toContain('dark:bg-navy-deep/90')
    expect(stage.getAttribute('class')).toContain('dark:')
    expect(advance.getAttribute('class')).toContain('bg-teal-600')
    expect(rollback.getAttribute('class')).not.toContain('bg-teal-600')
    expect(screen.getByText('operator@example.com')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Preview as client' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Toggle ER theme' })).toBeTruthy()
    expect(container.querySelector('[data-operator-status-dot]')).toBeTruthy()
    expect(container.querySelectorAll('#vb-operator-bar')).toHaveLength(1)
    expect(container.querySelector('[data-vb-section-outline]')).toBeNull()
    expect(container.querySelector('[data-vb-inspector-panes]')).toBeNull()
    expect(screen.queryByRole('button', { name: /^(hide|show|mark done|reopen|reset acknowledgment)$/i })).toBeNull()
  })

  it('shows a live busy status and disables stage actions during a mutation', async () => {
    let resolveFetch!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve })))
    render(
      <PresentationModeProvider>
        <OperatorBar viewbookId={42} operatorEmail="operator@example.com" stage="kickoff" pcCompletedAt={null} />
      </PresentationModeProvider>,
    )

    const advance = await screen.findByRole('button', { name: 'Advance' })
    const rollback = screen.getByRole('button', { name: 'Roll back' })
    fireEvent.click(advance)
    expect(await screen.findByText('Updating stage…')).toBeTruthy()
    expect((advance as HTMLButtonElement).disabled).toBe(true)
    expect((rollback as HTMLButtonElement).disabled).toBe(true)

    resolveFetch(response({ stage: 'building' }))
    await waitFor(() => expect(screen.queryByText('Updating stage…')).toBeNull())
  })

  it('renders stage errors in a dark-aware tinted alert row', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'stage_update_failed' }, 500)))
    render(
      <PresentationModeProvider>
        <OperatorBar viewbookId={42} operatorEmail="operator@example.com" stage="kickoff" pcCompletedAt={null} />
      </PresentationModeProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Advance' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('stage_update_failed')
    expect(alert.getAttribute('class')).toContain('bg-red-50')
    expect(alert.getAttribute('class')).toContain('dark:bg-red-500/10')
  })

  it('handles post-contract ack_incomplete by confirming and retrying with force', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ error: 'ack_incomplete' }, 409))
      .mockResolvedValueOnce(response({ stage: 'kickoff' }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(
      <PresentationModeProvider>
        <OperatorBar viewbookId={42} operatorEmail="operator@example.com" stage="post-contract" pcCompletedAt={null} />
      </PresentationModeProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Advance' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      direction: 'forward',
      expectedStage: 'post-contract',
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      direction: 'forward',
      expectedStage: 'post-contract',
      force: true,
    })
    expect(confirm).toHaveBeenCalledWith('Acknowledgments are incomplete — advance anyway?')
    expect(requestRefresh).toHaveBeenCalledOnce()
  })
})
