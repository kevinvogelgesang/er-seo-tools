// components/ada-audit/AuditIndexTabs.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

let mockSearch = ''
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(mockSearch) }))
vi.mock('./AuditForm', () => ({ default: () => <div data-testid="single-form" /> }))
vi.mock('./SiteAuditForm', () => ({ default: () => <div data-testid="site-form" /> }))
vi.mock('./ClientsAuditSummary', () => ({ default: () => null }))
vi.mock('./DashboardQueueStatus', () => ({ default: () => null }))
vi.mock('./RecentsTable', () => ({ default: () => null }))

import AuditIndexTabs from './AuditIndexTabs'

afterEach(cleanup)

describe('AuditIndexTabs (C16)', () => {
  beforeEach(() => {
    mockSearch = ''
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({})))
  })

  it('defaults to the Site Audit tab', () => {
    render(<AuditIndexTabs recentItems={[]} operator={null} initialScope="all" />)
    expect(screen.getByTestId('site-form')).toBeTruthy()
    expect(screen.queryByTestId('single-form')).toBeNull()
  })

  it('renders Site Audit as the FIRST tab', () => {
    render(<AuditIndexTabs recentItems={[]} operator={null} initialScope="all" />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0].textContent).toContain('Site Audit')
    expect(tabs[1].textContent).toContain('Single Page')
  })

  it('?auditTab=single deep-link still works', () => {
    mockSearch = 'auditTab=single'
    render(<AuditIndexTabs recentItems={[]} operator={null} initialScope="all" />)
    expect(screen.getByTestId('single-form')).toBeTruthy()
  })
})
