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
})
