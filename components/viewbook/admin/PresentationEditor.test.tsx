// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PresentationEditor } from './PresentationEditor'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const CONFIG = {
  collapseAffordance: 'chevron' as const,
  heroOverlayStrength: 55,
  revealDurationScale: 1.0,
  firstLoadDelayMs: 3000,
}

describe('PresentationEditor', () => {
  it('changing the affordance select PATCHes {collapseAffordance} then calls onSaved', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()
    render(<PresentationEditor viewbookId={7} config={CONFIG} onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText('Collapse affordance'), { target: { value: 'pill' } })

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/7', {
      method: 'PATCH',
      body: JSON.stringify({ collapseAffordance: 'pill' }),
    })
  })

  it('the overlay slider is controlled and PATCHes {heroOverlayStrength} on blur AND on keyboard commit (Enter), not only pointer release', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()
    render(<PresentationEditor viewbookId={7} config={CONFIG} onSaved={onSaved} />)

    const slider = screen.getByLabelText(/Hero overlay strength/) as HTMLInputElement
    expect(slider.value).toBe('55') // controlled, seeded from config

    // Changing the value alone (no blur/Enter yet) must NOT save — it's a
    // pointer-drag-in-progress; only commit on blur or a keyboard Enter.
    fireEvent.change(slider, { target: { value: '20' } })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(slider.value).toBe('20')

    // Commit via blur.
    fireEvent.blur(slider)
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/7', {
      method: 'PATCH',
      body: JSON.stringify({ heroOverlayStrength: 20 }),
    })

    fetchMock.mockClear()
    onSaved.mockClear()

    // Commit via keyboard (Enter) — never only pointer release (keyboard
    // users must be able to save; Codex FIX-10).
    fireEvent.change(slider, { target: { value: '80' } })
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.keyUp(slider, { key: 'Enter' })
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/7', {
      method: 'PATCH',
      body: JSON.stringify({ heroOverlayStrength: 80 }),
    })
  })

  it('a non-Enter keyup does not commit', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<PresentationEditor viewbookId={7} config={CONFIG} onSaved={vi.fn()} />)

    const slider = screen.getByLabelText(/Hero overlay strength/) as HTMLInputElement
    fireEvent.change(slider, { target: { value: '30' } })
    fireEvent.keyUp(slider, { key: 'ArrowLeft' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the affordance select is seeded from config and disabled while a save is in flight', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <PresentationEditor
        viewbookId={7}
        config={{ collapseAffordance: 'chevron', heroOverlayStrength: 10, revealDurationScale: 1.0, firstLoadDelayMs: 3000 }}
        onSaved={vi.fn()}
      />)

    const select = screen.getByLabelText('Collapse affordance') as HTMLSelectElement
    expect(select.value).toBe('chevron')

    fireEvent.change(select, { target: { value: 'pill' } })
    expect(select.disabled).toBe(true)

    resolveFetch({ ok: true, json: async () => ({ ok: true }) })
    await waitFor(() => expect(select.disabled).toBe(false))
  })

  it('clicking the "Brisk" reveal-pace preset PATCHes {revealDurationScale: 0.7} immediately', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()
    render(<PresentationEditor viewbookId={7} config={CONFIG} onSaved={onSaved} />)

    fireEvent.click(screen.getByRole('button', { name: 'Brisk' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/7', {
      method: 'PATCH',
      body: JSON.stringify({ revealDurationScale: 0.7 }),
    })
  })

  it('the reveal-pace slider is controlled and PATCHes {revealDurationScale} only on blur/Enter, never mid-drag', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()
    render(<PresentationEditor viewbookId={7} config={CONFIG} onSaved={onSaved} />)

    const slider = screen.getByLabelText(/Reveal pace/) as HTMLInputElement
    expect(slider.value).toBe('1') // controlled, seeded from config's revealDurationScale

    // Dragging (change events with no blur/Enter yet) must NOT save.
    fireEvent.change(slider, { target: { value: '1.2' } })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(slider.value).toBe('1.2')

    fireEvent.blur(slider)
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/7', {
      method: 'PATCH',
      body: JSON.stringify({ revealDurationScale: 1.2 }),
    })

    fetchMock.mockClear()
    onSaved.mockClear()

    fireEvent.change(slider, { target: { value: '0.55' } })
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.keyUp(slider, { key: 'Enter' })
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/7', {
      method: 'PATCH',
      body: JSON.stringify({ revealDurationScale: 0.55 }),
    })
  })

  it('the first-load delay slider is controlled and PATCHes {firstLoadDelayMs} only on blur/Enter, never mid-drag', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()
    render(<PresentationEditor viewbookId={7} config={CONFIG} onSaved={onSaved} />)

    const slider = screen.getByLabelText(/First-load delay/) as HTMLInputElement
    expect(slider.value).toBe('3000') // controlled, seeded from config's firstLoadDelayMs

    // Dragging must NOT save mid-drag.
    fireEvent.change(slider, { target: { value: '4500' } })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(slider.value).toBe('4500')

    fireEvent.blur(slider)
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/7', {
      method: 'PATCH',
      body: JSON.stringify({ firstLoadDelayMs: 4500 }),
    })

    fetchMock.mockClear()
    onSaved.mockClear()

    fireEvent.change(slider, { target: { value: '0' } })
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.keyUp(slider, { key: 'Enter' })
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/viewbooks/7', {
      method: 'PATCH',
      body: JSON.stringify({ firstLoadDelayMs: 0 }),
    })
  })
})
