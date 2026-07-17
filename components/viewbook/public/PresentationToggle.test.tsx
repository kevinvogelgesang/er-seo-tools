// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  PresentationModeProvider,
  PresentationToggle,
  usePresentationMode,
} from './PresentationToggle'

function ChromeProbe() {
  const { initialized, presenting } = usePresentationMode()
  if (!initialized || presenting) return null
  return <div data-testid="operator-chrome">Operator chrome</div>
}

function Harness() {
  return (
    <PresentationModeProvider>
      <ChromeProbe />
      <PresentationToggle />
    </PresentationModeProvider>
  )
}

let stored = new Map<string, string>()

beforeEach(() => {
  stored = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PresentationToggle', () => {
  it('initializes OFF without rendering operator chrome before storage is read', async () => {
    render(<Harness />)
    const toggle = await screen.findByRole('button', { name: 'Presentation mode' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('operator-chrome')).toBeTruthy()
  })

  it('toggles presentation mode, persists it, and leaves a re-enable affordance', async () => {
    render(<Harness />)
    const toggle = await screen.findByRole('button', { name: 'Presentation mode' })
    fireEvent.click(toggle)

    await waitFor(() => expect(screen.queryByTestId('operator-chrome')).toBeNull())
    expect(localStorage.getItem('vb-presentation-mode')).toBe('true')
    const restore = screen.getByRole('button', { name: 'Show editing controls' })
    expect(restore.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(restore)
    await screen.findByTestId('operator-chrome')
    expect(localStorage.getItem('vb-presentation-mode')).toBe('false')
  })

  it('restores a persisted ON state without flashing operator chrome', async () => {
    localStorage.setItem('vb-presentation-mode', 'true')
    render(<Harness />)

    expect(screen.queryByTestId('operator-chrome')).toBeNull()
    const restore = await screen.findByRole('button', { name: 'Show editing controls' })
    expect(screen.queryByTestId('operator-chrome')).toBeNull()
    expect(restore.getAttribute('aria-pressed')).toBe('true')
  })
})
