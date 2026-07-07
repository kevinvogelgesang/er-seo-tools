// components/shell/Topbar.test.tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Topbar } from './Topbar'

const pathnameMock = vi.hoisted(() => ({ value: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => pathnameMock.value }))
// ThemeToggle reads ThemeProvider context; stub it — its behavior is tested elsewhere.
vi.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => <div data-testid="theme-toggle" /> }))

afterEach(cleanup)

describe('Topbar', () => {
  it('shows the active tool name as the page title', () => {
    pathnameMock.value = '/seo-parser/diff'
    render(<Topbar onMenuClick={() => {}} />)
    expect(screen.getByRole('heading', { name: 'SEO Parser' })).toBeTruthy()
  })

  it('falls back to Home on the root path', () => {
    pathnameMock.value = '/'
    render(<Topbar onMenuClick={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy()
  })

  it('preserves the logout affordance as a plain form POST (Codex fix 6)', () => {
    pathnameMock.value = '/'
    render(<Topbar onMenuClick={() => {}} />)
    const btn = screen.getByRole('button', { name: 'Log out' })
    const form = btn.closest('form')!
    expect(form.getAttribute('action')).toBe('/api/auth/logout')
    expect(form.getAttribute('method')).toBe('post')
  })

  it('renders the theme toggle and the mobile menu button', () => {
    pathnameMock.value = '/'
    render(<Topbar onMenuClick={() => {}} />)
    expect(screen.getByTestId('theme-toggle')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open navigation menu' })).toBeTruthy()
  })
})
