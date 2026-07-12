// components/ada-audit/AuditIndexTabs.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

let mockSearch = ''
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(mockSearch) }))
vi.mock('./AuditForm', () => ({ default: () => <div data-testid="single-form" /> }))
vi.mock('./SiteAuditForm', () => ({
  default: ({ queueStatus }: { queueStatus: unknown }) => (
    <div data-testid="site-form" data-queue={JSON.stringify(queueStatus)} />
  ),
}))
vi.mock('./ClientsAuditSummary', () => ({ default: () => null }))
vi.mock('./DashboardQueueStatus', () => ({
  default: ({ queueStatus }: { queueStatus: unknown }) => (
    <div data-testid="dashboard-queue-status" data-queue={JSON.stringify(queueStatus)} />
  ),
}))
vi.mock('./RecentsTable', () => ({ default: () => null }))

// A5: the component now reads queue state from the shared SSE-aware store
// instead of running its own inline fetch/setInterval poll.
const queueMock = vi.hoisted(() => ({ value: { data: null as any, error: false, loading: false } }))
vi.mock('@/lib/widgets/queue-poll', () => ({ useQueueStatus: () => queueMock.value }))

import AuditIndexTabs from './AuditIndexTabs'

afterEach(cleanup)

describe('AuditIndexTabs (C16)', () => {
  beforeEach(() => {
    mockSearch = ''
    queueMock.value = { data: null, error: false, loading: false }
  })

  it('defaults to the Site Audit tab', () => {
    render(<AuditIndexTabs recentItems={[]} operator={null} initialScope="all" />)
    expect(screen.getByTestId('site-form')).toBeTruthy()
    expect(screen.queryByTestId('single-form')).toBeNull()
  })

  it('passes the store queue state down to DashboardQueueStatus and the SiteAuditForm banner (A5)', () => {
    const data = {
      active: { id: 'a1', domain: 'example.com', status: 'running', pagesTotal: 10, pagesComplete: 4, pagesError: 0, pdfsTotal: 0, pdfsComplete: 0, pdfsError: 0, pdfsSkipped: 0, lighthouseTotal: 0, lighthouseComplete: 0, lighthouseError: 0, clientId: null },
      queued: [],
      batch: null,
    }
    queueMock.value = { data, error: false, loading: false }
    render(<AuditIndexTabs recentItems={[]} operator={null} initialScope="all" />)
    expect(screen.getByTestId('dashboard-queue-status').getAttribute('data-queue')).toBe(JSON.stringify(data))
    expect(screen.getByTestId('site-form').getAttribute('data-queue')).toBe(JSON.stringify(data))
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
