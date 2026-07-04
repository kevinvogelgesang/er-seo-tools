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
  it('labels a fallback score as v1 / unavailable', () => {
    render(<ScoreVersionBadge version={1} fromFallback={true} passCount={null} incompleteCount={null} />)
    expect(screen.getByText(/v1/i)).toBeTruthy()
  })
})
