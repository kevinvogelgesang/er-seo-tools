// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import SiteAuditDiffPanel from './SiteAuditDiffPanel'
import type { InstanceDiff, RuleInstanceDiff } from '@/lib/services/findings-shared'

afterEach(cleanup)

function makeRule(overrides: Partial<RuleInstanceDiff> = {}): RuleInstanceDiff {
  return {
    type: 'color-contrast',
    severity: 'critical',
    newUrls: ['/a', '/b'],
    newTotal: 2,
    regressedTotal: 1,
    resolvedUrls: [],
    resolvedTotal: 0,
    unchangedTotal: 3,
    ...overrides,
  }
}

function makeDiff(overrides: Partial<InstanceDiff> = {}): InstanceDiff {
  return {
    newCount: 2,
    regressedCount: 1,
    newPageCount: 1,
    resolvedCount: 1,
    notRescannedCount: 2,
    unchangedCount: 5,
    rules: [
      makeRule(),
      makeRule({ type: 'label', severity: 'warning', newUrls: [], newTotal: 0, regressedTotal: 0, resolvedUrls: ['/gone'], resolvedTotal: 1, unchangedTotal: 0 }),
    ],
    ...overrides,
  }
}

const previous = { siteAuditId: 'prev-site-1', completedAt: '2026-06-01T10:00:00.000Z' }

describe('SiteAuditDiffPanel', () => {
  it('renders headline chips for a mixed diff', () => {
    render(<SiteAuditDiffPanel diff={makeDiff()} previous={previous} />)
    expect(screen.getByText(/2 new \(1 regressed · 1 on new pages\)/)).toBeTruthy()
    expect(screen.getByText('1 resolved')).toBeTruthy() // chip; the rule row reads "−1 resolved"
    expect(screen.getByText(/5 unchanged/)).toBeTruthy()
    expect(screen.getByText(/2 not re-scanned/)).toBeTruthy()
  })

  it('renders per-rule rows with severity pill and expandable URL list with cap footer', () => {
    const diff = makeDiff({
      rules: [makeRule({ newUrls: ['/a', '/b'], newTotal: 30, regressedTotal: 1 })],
    })
    render(<SiteAuditDiffPanel diff={diff} previous={previous} />)
    expect(screen.getByText('critical')).toBeTruthy()
    expect(screen.getByText('color-contrast')).toBeTruthy()
    expect(screen.getByText(/\+30 new \(1 regressed\)/)).toBeTruthy()
    // Collapsed by default.
    expect(screen.queryByText('/a')).toBeNull()
    fireEvent.click(screen.getByText('color-contrast'))
    expect(screen.getByText('/a')).toBeTruthy()
    expect(screen.getByText('/b')).toBeTruthy()
    expect(screen.getByText(/…and 28 more/)).toBeTruthy()
  })

  it('shows the NEW badge only on rules with no unchanged and no resolved instances', () => {
    const diff = makeDiff({
      rules: [
        makeRule({ type: 'brand-new-rule', unchangedTotal: 0, resolvedTotal: 0, newTotal: 2 }),
        makeRule({ type: 'existing-rule', unchangedTotal: 3, newTotal: 1 }),
      ],
    })
    render(<SiteAuditDiffPanel diff={diff} previous={previous} />)
    const badges = screen.getAllByText('NEW')
    expect(badges).toHaveLength(1)
  })

  it('renders resolved URLs on expand', () => {
    render(<SiteAuditDiffPanel diff={makeDiff()} previous={previous} />)
    fireEvent.click(screen.getByText('label'))
    expect(screen.getByText('Resolved on:')).toBeTruthy()
    expect(screen.getByText('/gone')).toBeTruthy()
  })

  it('clean diff renders the no-changes line with the baseline date instead of rule rows', () => {
    const diff = makeDiff({ newCount: 0, regressedCount: 0, newPageCount: 0, resolvedCount: 0, notRescannedCount: 0, unchangedCount: 9, rules: [] })
    const { container } = render(<SiteAuditDiffPanel diff={diff} previous={previous} />)
    expect(container.textContent).toContain('No accessibility changes vs the previous audit')
    expect(screen.getByText(/0 new$/)).toBeTruthy()
  })

  it('links to the baseline site audit when previous.siteAuditId is present', () => {
    render(<SiteAuditDiffPanel diff={makeDiff()} previous={previous} />)
    const link = screen.getByText(/view baseline/).closest('a')
    expect(link?.getAttribute('href')).toBe('/ada-audit/site/prev-site-1')
  })

  it('omits the baseline link and date when previous metadata is null (pruned baseline)', () => {
    render(<SiteAuditDiffPanel diff={makeDiff()} previous={{ siteAuditId: null, completedAt: null }} />)
    expect(screen.queryByText(/view baseline/)).toBeNull()
    expect(screen.queryByText(/baseline/)).toBeNull()
  })
})
