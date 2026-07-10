// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ScoreVersionBadge } from './ScoreVersionBadge'

afterEach(cleanup)

describe('ScoreVersionBadge', () => {
  it('shows a v2 badge and pass/incomplete counts', () => {
    render(<ScoreVersionBadge version={2} fromFallback={false} passCount={40} incompleteCount={3} />)
    expect(screen.getByText(/v2/i)).toBeTruthy()
    expect(screen.getByText(/40/)).toBeTruthy()
    expect(screen.getByText(/3/)).toBeTruthy()
  })
  it('C13: renders the numeric version for v3 (repaired incomplete input)', () => {
    render(<ScoreVersionBadge version={3} fromFallback={false} passCount={38} incompleteCount={4} />)
    expect(screen.getByText(/v3/i)).toBeTruthy()
    expect(screen.getByText(/38 passed/)).toBeTruthy()
    expect(screen.getByText(/4 needs review/)).toBeTruthy()
  })
  it('C19: renders the numeric version for v4 (ADA v4 prevalence-deduction scorer)', () => {
    render(<ScoreVersionBadge version={4} fromFallback={false} passCount={38} incompleteCount={4} />)
    expect(screen.getByText(/v4/i)).toBeTruthy()
  })

  it('labels a fallback score as v1 / unavailable', () => {
    render(<ScoreVersionBadge version={1} fromFallback={true} passCount={null} incompleteCount={null} />)
    expect(screen.getByText(/v1/i)).toBeTruthy()
  })
})
