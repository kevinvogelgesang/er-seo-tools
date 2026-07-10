// @vitest-environment jsdom
// components/clients/Scorecard.test.tsx
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { Scorecard } from './Scorecard'

// globals:false → testing-library auto-cleanup is off; clean explicitly.
afterEach(cleanup)

describe('Scorecard', () => {
  it('renders the score, max and an up-delta', () => {
    render(<Scorecard label="SEO Health" score={90} max={100} delta={5} asOf="2026-06-10T00:00:00.000Z" href="/seo-audits/results/x" points={[]} />)
    expect(screen.getByText('90')).toBeTruthy()
    expect(screen.getByText('▲ 5')).toBeTruthy()
    expect(screen.getByText('SEO Health')).toBeTruthy()
  })
  it('renders a down-delta', () => {
    render(<Scorecard label="ADA" score={60} max={100} delta={-12} asOf={null} href={null} points={[]} />)
    expect(screen.getByText('▼ 12')).toBeTruthy()
  })
  it('renders the empty state when score is null', () => {
    render(<Scorecard label="Pillar" score={null} max={10} delta={null} asOf={null} href={null} points={[]} />)
    expect(screen.getByText('No runs yet')).toBeTruthy()
  })
  it('shows the source note when provided', () => {
    render(<Scorecard label="ADA" score={75} max={100} delta={null} asOf={null} href={null} points={[]} sourceNote="page audits" />)
    expect(screen.getByText('page audits')).toBeTruthy()
  })
  it('renders sourceNote as a gray uppercase SeverityBadge', () => {
    render(<Scorecard label="ADA" score={75} max={100} delta={null} asOf={null} href={null} points={[]} sourceNote="page audits" />)
    const el = screen.getByText('page audits')
    expect(el.className).toContain('text-gray-600')
    expect(el.className).toContain('uppercase')
    expect(el.className).toContain('px-1.5')
  })
})
