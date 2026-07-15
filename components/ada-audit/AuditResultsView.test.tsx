// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import AuditResultsView from './AuditResultsView'
import type { StoredAxeResults } from '@/lib/ada-audit/types'

// This vitest jsdom setup exposes no working localStorage (window.localStorage
// is undefined) — provide an in-memory stand-in, re-stubbed per test because
// afterEach unstubs all globals (AuditResultsView reads the triage-mode key).
const lsStore = new Map<string, string>()
const localStorageMock = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => { lsStore.set(k, String(v)) },
  removeItem: (k: string) => { lsStore.delete(k) },
  clear: () => { lsStore.clear() },
}

beforeEach(() => { lsStore.clear(); vi.stubGlobal('localStorage', localStorageMock) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); lsStore.clear() })

function makeResults(overrides: Partial<StoredAxeResults> = {}): StoredAxeResults {
  return {
    violations: [],
    passes: [{ id: 'p1', help: 'p', nodes: [] }],
    incomplete: [],
    inapplicable: [],
    timestamp: '2026-06-12T00:00:00Z',
    url: 'https://x.example/a',
    testEngine: { name: 'axe-core', version: '4.10' },
    testRunner: { name: 'er-seo-tools' },
    ...overrides,
  }
}

const baseProps = {
  url: 'https://x.example/a',
  clientName: null,
  createdAt: '2026-06-12T00:00:00.000Z',
  auditId: 'audit-1',
}

describe('AuditResultsView — archived render contract', () => {
  it('live results: triage toggle present, no archived banner, low-DOM warning shows', () => {
    render(
      <AuditResultsView {...baseProps} results={makeResults({ domElementCount: 10 })} />,
    )
    expect(screen.getByText(/Triage off/)).toBeTruthy()
    expect(screen.queryByText(/Archived audit:/)).toBeNull()
    expect(screen.getByText(/Unreliable result:/)).toBeTruthy()
    expect(screen.getByText(/rules passed/).textContent).toContain('1 rules passed')
  })

  it('C13: trimmed blob (passCount scalar, no passes array) renders the scalar and real incomplete', () => {
    const trimmed = makeResults({ domElementCount: 500 })
    delete (trimmed as Record<string, unknown>).passes
    delete (trimmed as Record<string, unknown>).inapplicable
    trimmed.passCount = 42
    trimmed.incomplete = [
      { id: 'i1', help: 'check me', impact: null, nodes: [] },
      { id: 'i2', help: 'me too', impact: null, nodes: [] },
    ]
    render(<AuditResultsView {...baseProps} results={trimmed} />)
    expect(screen.getByText(/rules passed/).textContent).toContain('42 rules passed')
    expect(screen.getByText(/need review/).textContent).toContain('2 need review')
  })

  it('archived results: banner rendered, archived counts shown — never the literal 0 from empty passes', () => {
    const { container } = render(
      <AuditResultsView
        {...baseProps}
        results={makeResults({ passes: [], archived: true, archivedCounts: { passed: 7, incomplete: 2 } })}
      />,
    )
    expect(screen.getByText(/Archived audit:/)).toBeTruthy()
    expect(container.textContent).toContain('7 rules passed')
    expect(container.textContent).toContain('2 need review')
    expect(container.textContent).not.toContain('0 rules passed')
  })

  it('archived results: no triage toggle and no checks context (plan-fix #2)', () => {
    render(
      <AuditResultsView
        {...baseProps}
        results={makeResults({ passes: [], archived: true, archivedCounts: { passed: null, incomplete: null } })}
      />,
    )
    expect(screen.queryByText(/Triage off/)).toBeNull()
    expect(screen.queryByText(/Triage on/)).toBeNull()
  })

  it('archived results: domElementCount warning suppressed, null counts render as "—"', () => {
    const { container } = render(
      <AuditResultsView
        {...baseProps}
        results={makeResults({
          passes: [], domElementCount: 10, archived: true,
          archivedCounts: { passed: null, incomplete: null },
        })}
      />,
    )
    expect(screen.queryByText(/Unreliable result:/)).toBeNull()
    expect(container.textContent).toContain('— rules passed')
    expect(container.textContent).toContain('— need review')
  })

  it('archived results without archivedCounts default to unknown ("—"), not 0', () => {
    const { container } = render(
      <AuditResultsView {...baseProps} results={makeResults({ passes: [], archived: true })} />,
    )
    expect(container.textContent).toContain('— rules passed')
  })

  it('omitting scoreMeta renders no version badge (backward-compatible)', () => {
    render(<AuditResultsView {...baseProps} results={makeResults()} score={90} />)
    expect(screen.queryByText(/^v1$/i)).toBeNull()
    expect(screen.queryByText(/^v2$/i)).toBeNull()
  })

  it('passing scoreMeta renders the version badge with pass/incomplete counts', () => {
    render(
      <AuditResultsView
        {...baseProps}
        results={makeResults()}
        score={90}
        scoreMeta={{ version: 2, fromFallback: false, passCount: 40, incompleteCount: 3 }}
      />,
    )
    expect(screen.getByText(/v2/i)).toBeTruthy()
    expect(screen.getByText(/40 passed/)).toBeTruthy()
    expect(screen.getByText(/3 needs review/)).toBeTruthy()
  })

  // C19 PR1 Task 5: the explanation panel is internal-only.
  it('renders the ADA score explanation invoice when scoreBreakdown is provided and not readOnly', () => {
    const breakdown = JSON.stringify({
      version: 4, scorer: 'ada-v4', score: 76, weightsHash: 'abc123', lowCoverage: false,
      deductions: [
        { category: 'critical', cap: 40, points: 12, contributions: [
          { ruleId: 'image-alt', impact: 'critical', prevalence: 0.3, pagesAffected: 61, advisory: false },
        ] },
      ],
      inputsSummary: { pagesAudited: 204, pagesTotal: 204, meanIncomplete: 0.4 },
    })
    render(<AuditResultsView {...baseProps} results={makeResults()} scoreBreakdown={breakdown} />)
    expect(screen.getByRole('button', { name: /How this score is calculated/i })).toBeTruthy()
  })

  it('does NOT render the ADA score explanation when readOnly, even with scoreBreakdown', () => {
    const breakdown = JSON.stringify({
      version: 4, scorer: 'ada-v4', score: 76, weightsHash: 'abc123', lowCoverage: false,
      deductions: [
        { category: 'critical', cap: 40, points: 12, contributions: [
          { ruleId: 'image-alt', impact: 'critical', prevalence: 0.3, pagesAffected: 61, advisory: false },
        ] },
      ],
      inputsSummary: { pagesAudited: 204, pagesTotal: 204, meanIncomplete: 0.4 },
    })
    render(<AuditResultsView {...baseProps} results={makeResults()} scoreBreakdown={breakdown} readOnly />)
    expect(screen.queryByRole('button', { name: /How this score is calculated/i })).toBeNull()
  })

  it('renders read-only without a localStorage global and does not throw', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() =>
      render(
        <AuditResultsView
          {...baseProps}
          results={makeResults()}
          readOnly
        />,
      ),
    ).not.toThrow()
  })
})
