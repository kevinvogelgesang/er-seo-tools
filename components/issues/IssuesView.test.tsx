// @vitest-environment jsdom
// components/issues/IssuesView.test.tsx
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { IssuesView } from './IssuesView'
import type { IssuesPayload } from '@/lib/sweep/read'
import type { IssueGroup, SweepSnapshot } from '@/lib/sweep/types'

afterEach(() => {
  cleanup()
})

function makeTotals(overrides: Partial<SweepSnapshot['totals']> = {}): SweepSnapshot['totals'] {
  return {
    actionable: 27,
    delta: -3,
    comparablePairs: 48,
    newCount: 4,
    worsenedCount: 2,
    resolvedCount: 5,
    scanned: 27,
    expected: 30,
    comparableDomains: 24,
    partialDomains: 2,
    failedDomains: 1,
    ...overrides,
  }
}

function makeGroup(overrides: Partial<IssueGroup> = {}): IssueGroup {
  return {
    clientId: 1,
    clientName: 'Acme College',
    domain: 'acme.edu',
    tool: 'ada-audit',
    type: 'color-contrast',
    severity: 'critical',
    unit: 'targets',
    affectedCount: 12,
    approximate: false,
    title: 'Insufficient color contrast',
    changeState: 'new',
    delta: null,
    streak: 1,
    severityChanged: null,
    coverageState: 'comparable',
    lastObservedAt: '2026-07-12T00:00:00.000Z',
    siteAuditId: 'sa-1',
    liveScanRunId: null,
    ...overrides,
  }
}

function makePayload(overrides: Partial<IssuesPayload> = {}): IssuesPayload {
  return {
    sweep: {
      scheduledFor: '2026-07-12T00:00:00.000Z',
      startedAt: '2026-07-12T01:00:00.000Z',
      snapshotAt: '2026-07-12T02:00:00.000Z',
      totals: makeTotals(),
    },
    inProgress: false,
    shortlist: [],
    groups: [],
    staleGroups: [],
    resolvedGroups: [],
    notComparable: [],
    ...overrides,
  }
}

describe('IssuesView', () => {
  it('renders the summary tiles from totals (never recomputed)', () => {
    render(<IssuesView payload={makePayload()} />)
    expect(screen.getByText('Current Scan Issues')).toBeTruthy()
    // Actionable tile value
    expect(screen.getByText('Actionable groups observed')).toBeTruthy()
    // New / worsened tile
    expect(screen.getByText(/4 new/)).toBeTruthy()
    expect(screen.getByText(/2 worsened/)).toBeTruthy()
    // No longer detected tile
    expect(screen.getByText('No longer detected')).toBeTruthy()
    // Coverage tile
    expect(screen.getByText('Sweep coverage')).toBeTruthy()
  })

  it('Actionable is the default filter and hides notice-severity rows', () => {
    const payload = makePayload({
      groups: [
        makeGroup({ title: 'Critical issue', severity: 'critical' }),
        makeGroup({ title: 'Notice issue', severity: 'notice', type: 'thin-content' }),
      ],
    })
    render(<IssuesView payload={payload} />)
    expect(screen.getByText('Critical issue')).toBeTruthy()
    expect(screen.queryByText('Notice issue')).toBeNull()
    // Switching to the Notices segment surfaces it
    fireEvent.click(screen.getByRole('button', { name: 'Notices' }))
    expect(screen.getByText('Notice issue')).toBeTruthy()
    expect(screen.queryByText('Critical issue')).toBeNull()
  })

  it('the tool filter narrows the table to one tool', () => {
    const payload = makePayload({
      groups: [
        makeGroup({ title: 'Ada issue', tool: 'ada-audit', severity: 'critical' }),
        makeGroup({
          title: 'Seo issue',
          tool: 'seo-parser',
          severity: 'warning',
          type: 'missing-title',
          siteAuditId: null,
          liveScanRunId: 'run-9',
        }),
      ],
    })
    render(<IssuesView payload={payload} />)
    expect(screen.getByText('Ada issue')).toBeTruthy()
    expect(screen.getByText('Seo issue')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ADA' }))
    expect(screen.getByText('Ada issue')).toBeTruthy()
    expect(screen.queryByText('Seo issue')).toBeNull()
  })

  it('renders stale rows dimmed with a STALE · LAST OBSERVED chip', () => {
    const payload = makePayload({
      staleGroups: [
        makeGroup({
          title: 'Stale issue',
          changeState: 'stale',
          lastObservedAt: '2026-07-05T00:00:00.000Z',
        }),
      ],
    })
    render(<IssuesView payload={payload} />)
    const cell = screen.getByText('Stale issue')
    expect(cell).toBeTruthy()
    expect(screen.getByText(/STALE/)).toBeTruthy()
    const row = cell.closest('tr')
    expect(row).not.toBeNull()
    expect(row!.className).toMatch(/opacity/)
  })

  it('the "No longer detected this week (N)" summary uses totals.resolvedCount, not resolvedGroups.length', () => {
    // Two resolved groups (one notice) but the canonical notice-filtered count is 1.
    const resolved = {
      clientId: 1,
      clientName: 'Acme College',
      domain: 'acme.edu',
      tool: 'seo-parser' as const,
      type: 'missing-title',
      title: 'Missing title',
      severity: 'warning' as const,
      priorCount: 3,
      unit: 'pages' as const,
      siteAuditId: null,
      liveScanRunId: null,
    }
    const payload = makePayload({
      sweep: {
        scheduledFor: '2026-07-12T00:00:00.000Z',
        startedAt: '2026-07-12T01:00:00.000Z',
        snapshotAt: '2026-07-12T02:00:00.000Z',
        totals: makeTotals({ resolvedCount: 1 }),
      },
      resolvedGroups: [resolved, { ...resolved, type: 'thin', severity: 'notice' as const, title: 'Thin content' }],
    })
    render(<IssuesView payload={payload} />)
    // summary count = canonical 1 (notice-filtered), NOT resolvedGroups.length (2).
    const summaryEl = document.querySelector('details > summary')
    expect(summaryEl?.textContent?.replace(/\s+/g, ' ').trim()).toBe('No longer detected this week (1)')
    // the list itself still renders BOTH resolved rows
    expect(screen.getByText('Thin content')).toBeTruthy()
    expect(screen.getByText('Missing title')).toBeTruthy()
  })

  it('shows the first-run empty state when sweep is null', () => {
    render(<IssuesView payload={makePayload({ sweep: null })} />)
    expect(screen.getByText(/first sweep runs Sunday evening/i)).toBeTruthy()
    expect(screen.queryByText('Actionable groups observed')).toBeNull()
  })

  it('shows an in-progress banner when payload.inProgress is set', () => {
    render(<IssuesView payload={makePayload({ inProgress: true })} />)
    expect(screen.getByText(/in progress/i)).toBeTruthy()
  })
})
