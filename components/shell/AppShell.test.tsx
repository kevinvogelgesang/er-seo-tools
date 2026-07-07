// components/shell/AppShell.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { AppShell } from './AppShell'

const pathnameMock = vi.hoisted(() => ({ value: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => pathnameMock.value }))
vi.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => <div data-testid="theme-toggle" /> }))

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

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  lsStore.clear()
  document.documentElement.removeAttribute('data-sidebar')
})
beforeEach(() => {
  pathnameMock.value = '/'
  lsStore.clear()
  vi.stubGlobal('localStorage', localStorageMock)
})

describe('AppShell', () => {
  it('renders children inside main', () => {
    render(<AppShell><p>page body</p></AppShell>)
    expect(screen.getByText('page body').closest('main')).toBeTruthy()
  })

  it('syncs collapse from the pre-hydration html attribute after mount', () => {
    // First render is always expanded (hydration-safe); the mount effect
    // reads the stamp and collapses. render() flushes effects, so the
    // icon-only state is observable here.
    document.documentElement.setAttribute('data-sidebar', 'collapsed')
    render(<AppShell><p>x</p></AppShell>)
    expect(screen.getByLabelText('Site Audits')).toBeTruthy()
  })

  it('toggling collapse persists to localStorage and stamps the html attribute', () => {
    render(<AppShell><p>x</p></AppShell>)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(localStorage.getItem('er-sidebar')).toBe('collapsed')
    expect(document.documentElement.getAttribute('data-sidebar')).toBe('collapsed')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(localStorage.getItem('er-sidebar')).toBe('expanded')
    expect(document.documentElement.getAttribute('data-sidebar')).toBeNull()
  })

  it('mobile drawer opens from the topbar menu button and closes on navigation', () => {
    render(<AppShell><p>x</p></AppShell>)
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
    const drawer = screen.getByRole('dialog', { name: 'Navigation' })
    expect(drawer).toBeTruthy()
    // clicking a nav link inside the drawer closes it
    fireEvent.click(screen.getAllByText('SEO Parser')[1] ?? screen.getAllByText('SEO Parser')[0])
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull()
  })

  it('mobile drawer closes on Escape', () => {
    render(<AppShell><p>x</p></AppShell>)
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).toBeNull()
  })
})
