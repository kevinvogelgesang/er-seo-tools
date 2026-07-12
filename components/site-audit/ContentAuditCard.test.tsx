// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ContentAuditCard } from './ContentAuditCard'

afterEach(cleanup)

describe('ContentAuditCard', () => {
  it('renders a mint control when a live-scan run exists', () => {
    render(<ContentAuditCard siteAuditId="a1" hasLiveScanRun={true} initialContentAuditJson={null} />)
    expect(screen.getByRole('button', { name: /content audit/i })).toBeTruthy()
  })
  it('renders nothing actionable when there is no live-scan run', () => {
    const { container } = render(<ContentAuditCard siteAuditId="a1" hasLiveScanRun={false} initialContentAuditJson={null} />)
    expect(container.querySelector('button')).toBeNull()
  })
  it('renders ingested findings grouped by type', () => {
    const json = JSON.stringify({ v: 1, generatedAt: new Date().toISOString(), findings: [
      { type: 'data_inconsistency', severity: 'warning', title: 'Tuition differs', detail: 'd', evidence: [{ url: 'https://x/a', snippet: 's' }], recommendation: 'r' },
    ] })
    render(<ContentAuditCard siteAuditId="a1" hasLiveScanRun={true} initialContentAuditJson={json} />)
    expect(screen.getAllByText(/Tuition differs/).length).toBeGreaterThan(0)
  })
})
