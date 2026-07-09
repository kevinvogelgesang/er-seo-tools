// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import SiteAuditResultsView from './SiteAuditResultsView'
import type { SiteAuditSummary, SitePageResult, CommonIssue } from '@/lib/ada-audit/types'

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

  it('omitting scoreMeta renders no version badge (backward-compatible)', () => {
    render(<SiteAuditResultsView {...baseProps} summary={makeSummary()} score={90} />)
    expect(screen.queryByText(/^v1$/i)).toBeNull()
    expect(screen.queryByText(/^v2$/i)).toBeNull()
  })

  it('passing scoreMeta renders the version badge with pass/incomplete counts', () => {
    render(
      <SiteAuditResultsView
        {...baseProps}
        summary={makeSummary()}
        score={90}
        scoreMeta={{ version: 2, fromFallback: false, passCount: 40, incompleteCount: 3 }}
      />,
    )
    expect(screen.getByText(/v2/i)).toBeTruthy()
    expect(screen.getByText(/40 passed/)).toBeTruthy()
    expect(screen.getByText(/3 needs review/)).toBeTruthy()
  })
})

function makePage(slug: string, overrides: Partial<SitePageResult> = {}): SitePageResult {
  return {
    adaAuditId: `ada-${slug}`,
    url: `https://x.example/${slug}`,
    status: 'complete',
    error: null,
    scorecard: { critical: 1, serious: 2, moderate: 0, minor: 0, total: 3, passed: 10, incomplete: 0 },
    lighthouse: null,
    pdfs: { total: 0, complete: 0, errored: 0, withIssues: 0 },
    violationIds: ['image-alt'],
    ...overrides,
  }
}

function makeCommonIssue(overrides: Partial<CommonIssue> = {}): CommonIssue {
  return {
    ruleId: 'image-alt',
    impact: 'critical',
    help: 'Images must have alternate text',
    description: 'Ensures <img> elements have alternate text',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
    affectedPagesCount: 2,
    totalPagesScanned: 2,
    sharedAncestor: null,
    ancestorConfidence: null,
    examplePageUrl: 'https://x.example/a',
    ...overrides,
  }
}

const shareSummary = () => makeSummary({
  aggregate: { critical: 2, serious: 4, moderate: 0, minor: 0, total: 6, passed: 20, incomplete: 0 },
  pages: [makePage('a'), makePage('b')],
  commonIssues: [makeCommonIssue()],
})

describe('SiteAuditResultsView — shareMode', () => {
  it('issues ZERO cookie-gated fetches even when rows and toolbar controls are clicked', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<SiteAuditResultsView {...baseProps} summary={shareSummary()} shareMode />)

    // Click a page row — must not expand (the expansion fetch is cookie-gated).
    const row = screen.getByText('x.example/a').closest('tr')!
    fireEvent.click(row)
    expect(screen.queryByText(/Loading violations/)).toBeNull()
    expect(screen.queryByText('View full audit ↗')).toBeNull()

    // Exercise the toolbar controls that remain in shareMode (pill names are
    // label-first; the scorecard impact tiles are count-first buttons).
    fireEvent.click(screen.getByRole('button', { name: /^Critical \d/ }))
    fireEvent.click(screen.getByRole('button', { name: /^All \d/ }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'critical' } })

    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.filter((u) => u.includes('/api/ada-audit/') || u.includes('/checks'))).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('hides the Triage toggle, the view-mode toggle, and the common-issue CTA; rows are not clickable', () => {
    render(<SiteAuditResultsView {...baseProps} summary={shareSummary()} shareMode />)

    expect(screen.queryByText(/Triage (on|off)/)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Violations/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Pages \d/ })).toBeNull()
    expect(screen.queryByText('View affected pages →')).toBeNull()
    // The common-issues summary itself still renders (server-loaded data).
    expect(screen.getByText(/Site-wide patterns/)).toBeTruthy()

    const row = screen.getByText('x.example/a').closest('tr')!
    expect(row.className).not.toContain('cursor-pointer')
  })

  it('keeps the external page-open anchor to the audited site', () => {
    render(<SiteAuditResultsView {...baseProps} summary={shareSummary()} shareMode />)
    const anchor = screen.getByTitle('Open https://x.example/a')
    expect(anchor.getAttribute('href')).toBe('https://x.example/a')
    expect(anchor.getAttribute('target')).toBe('_blank')
  })

  it('renders without any localStorage global — the triage effect must be skipped', () => {
    // jsdom here has NO working localStorage; shareMode must never touch it.
    vi.unstubAllGlobals()
    expect(() =>
      render(<SiteAuditResultsView {...baseProps} summary={shareSummary()} shareMode />),
    ).not.toThrow()
    expect(screen.getByText('x.example/a')).toBeTruthy()
  })

  it('default (non-share) mode keeps the internal affordances', () => {
    render(<SiteAuditResultsView {...baseProps} summary={shareSummary()} />)

    expect(screen.getByText(/Triage (on|off)/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Violations/ })).toBeTruthy()
    // C18: the old "View affected pages" CTA is replaced by an expandable
    // "Show affected elements" control on each pattern card.
    expect(screen.getByRole('button', { name: /show affected elements/i })).toBeTruthy()

    const row = screen.getByText('x.example/a').closest('tr')!
    expect(row.className).toContain('cursor-pointer')
  })
})
