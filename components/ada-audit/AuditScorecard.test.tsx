// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import AuditScorecard from './AuditScorecard'
import type { AuditScorecard as Scorecard } from '@/lib/ada-audit/types'

const scorecard: Scorecard = {
  critical: 1, serious: 0, moderate: 0, minor: 0, total: 1, passed: 0, incomplete: 0,
}

afterEach(cleanup)

describe('AuditScorecard — archivedCounts render contract', () => {
  it('renders scorecard.passed and hides the incomplete row when not archived', () => {
    const { container } = render(<AuditScorecard scorecard={{ ...scorecard, passed: 12 }} />)
    expect(container.textContent).toContain('12 rules passed')
    expect(container.textContent).not.toContain('need review')
  })

  it('renders archived counts instead of the synthesized-empty scorecard values', () => {
    const { container } = render(
      <AuditScorecard scorecard={scorecard} archivedCounts={{ passed: 7, incomplete: 3 }} />,
    )
    expect(container.textContent).toContain('7 rules passed')
    expect(container.textContent).toContain('3 need review')
    // Never the literal 0 from empty synthesized passes.
    expect(container.textContent).not.toContain('0 rules passed')
  })

  it('renders "—" and keeps the incomplete row VISIBLE when archived counts are null (plan-fix #1)', () => {
    const { container } = render(
      <AuditScorecard scorecard={scorecard} archivedCounts={{ passed: null, incomplete: null }} />,
    )
    expect(container.textContent).toContain('— rules passed')
    expect(container.textContent).toContain('— need review')
  })

  it('hides the incomplete row when the archived count is known-zero', () => {
    const { container } = render(
      <AuditScorecard scorecard={scorecard} archivedCounts={{ passed: 5, incomplete: 0 }} />,
    )
    expect(container.textContent).not.toContain('need review')
  })
})
