// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { ScoreRing } from './ScoreRing'

afterEach(cleanup)

describe('ScoreRing', () => {
  it('shows the score number', () => {
    render(<ScoreRing score={82} />)
    expect(screen.getByText('82')).toBeTruthy()
  })
  it('renders a dash when score is null', () => {
    render(<ScoreRing score={null} />)
    expect(screen.getByText('—')).toBeTruthy()
  })
})
