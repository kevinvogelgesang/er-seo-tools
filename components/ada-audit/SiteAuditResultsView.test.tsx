// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import SiteAuditResultsView from './SiteAuditResultsView'
import type { SiteAuditSummary } from '@/lib/ada-audit/types'

// This vitest jsdom setup exposes no working localStorage (window.localStorage
// is undefined) — provide an in-memory stand-in, re-stubbed per test because
// afterEach unstubs all globals (the view reads the triage-mode key).
const lsStore = new Map<string, string>()
const localStorageMock = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => { lsStore.set(k, String(v)) },
  removeItem: (k: string) => { lsStore.delete(k) },
  clear: () => { lsStore.clear() },
}

beforeEach(() => { lsStore.clear(); vi.stubGlobal('localStorage', localStorageMock) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); lsStore.clear() })

function makeSummary(overrides: Partial<SiteAuditSummary> = {}): SiteAuditSummary {
  return {
    aggregate: { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0, passed: 0, incomplete: 0 },
    pdfsAggregate: { total: 0, complete: 0, errored: 0, skipped: 0, withIssues: 0 },
    pages: [],
    ...overrides,
  }
}

const baseProps = {
  domain: 'x.example',
  clientName: null,
  createdAt: '2026-06-12T00:00:00.000Z',
  pagesTotal: 3,
  pagesError: 0,
  siteAuditId: 'site-1',
}

describe('SiteAuditResultsView — archived render contract', () => {
  it('live summary: no archived banner; scorecard uses aggregate values', () => {
    const { container } = render(
      <SiteAuditResultsView
        {...baseProps}
        summary={makeSummary({ aggregate: { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0, passed: 12, incomplete: 0 } })}
      />,
    )
    expect(screen.queryByText(/Archived audit:/)).toBeNull()
    expect(container.textContent).toContain('12 rules passed')
  })

  it('archived summary: banner rendered and archivedCounts drive the scorecard', () => {
    const { container } = render(
      <SiteAuditResultsView
        {...baseProps}
        summary={makeSummary({ archived: true, archivedCounts: { passed: 40, incomplete: 4 } })}
      />,
    )
    expect(screen.getByText(/Archived audit:/)).toBeTruthy()
    expect(container.textContent).toContain('full per-page detail was pruned after 90 days')
    expect(container.textContent).toContain('40 rules passed')
    expect(container.textContent).toContain('4 need review')
  })

  it('archived summary with unknown counts renders "—" rows, never literal 0', () => {
    const { container } = render(
      <SiteAuditResultsView
        {...baseProps}
        summary={makeSummary({ archived: true, archivedCounts: { passed: null, incomplete: null } })}
      />,
    )
    expect(container.textContent).toContain('— rules passed')
    expect(container.textContent).toContain('— need review')
    expect(container.textContent).not.toContain('0 rules passed')
  })
})
