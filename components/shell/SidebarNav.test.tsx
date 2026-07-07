// components/shell/SidebarNav.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { SidebarNav } from './SidebarNav'

// Active-state detection uses usePathname
const pathnameMock = vi.hoisted(() => ({ value: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => pathnameMock.value }))

afterEach(cleanup)

const noop = () => {}

describe('SidebarNav', () => {
  it('renders every group label and tool name when expanded', () => {
    pathnameMock.value = '/'
    render(<SidebarNav collapsed={false} onToggleCollapse={noop} />)
    for (const label of ['Overview', 'Run', 'Plan', 'Reference']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getByText('Site Audits')).toBeTruthy()
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy()
  })

  it('marks the active tool via aria-current and shows its children', () => {
    pathnameMock.value = '/ada-audit/queue'
    render(<SidebarNav collapsed={false} onToggleCollapse={noop} />)
    const active = screen.getByText('Site Audits').closest('a')!
    expect(active.getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('Audit queue')).toBeTruthy() // sub-links visible for active tool
    expect(screen.queryByText('Compare crawls')).toBeNull() // inactive tool's children hidden
  })

  it('collapsed mode hides text labels but keeps links with accessible names', () => {
    pathnameMock.value = '/'
    render(<SidebarNav collapsed onToggleCollapse={noop} />)
    expect(screen.queryByText('Overview')).toBeNull()
    expect(screen.getByLabelText('Site Audits')).toBeTruthy()
    expect(screen.queryByText('Audit queue')).toBeNull() // no sub-links when collapsed
  })

  it('fires onNavigate when a link is clicked and onToggleCollapse from the collapse button', () => {
    pathnameMock.value = '/'
    const onNavigate = vi.fn()
    const onToggle = vi.fn()
    render(<SidebarNav collapsed={false} onToggleCollapse={onToggle} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText('SEO Parser'))
    expect(onNavigate).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('never renders hidden tools and omits the collapse control when told to', () => {
    pathnameMock.value = '/'
    render(<SidebarNav collapsed={false} onToggleCollapse={noop} showCollapseControl={false} />)
    expect(screen.queryByText('Keyword Research')).toBeNull()
    expect(screen.queryByText('Pillar Analysis')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).toBeNull()
  })
})
