// @vitest-environment jsdom
// components/clients/QuarterContextCard.test.tsx
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { QuarterContextCard } from './QuarterContextCard'
import type { QuarterContext } from '@/lib/services/client-quarter'

afterEach(cleanup)

const ctx = (over: Partial<QuarterContext> = {}): QuarterContext => ({
  planName: 'Q3 plan', startDate: '2026-07-06',
  week: 3, weekRange: '7/20–7/24', priority: 2, status: 'in_progress', note: '',
  completed: false, completedAt: null, latestActivity: null, ...over,
})

describe('QuarterContextCard', () => {
  it('renders the absent state', () => {
    render(<QuarterContextCard context={null} />)
    expect(screen.getByText('Not in the current quarter plan')).toBeTruthy()
    expect(screen.getByText('View grid →').closest('a')?.getAttribute('href')).toBe('/quarter-grid')
  })

  it('renders the pool state', () => {
    render(<QuarterContextCard context={ctx({ week: null, weekRange: null })} />)
    expect(screen.getByText('In pool — not scheduled')).toBeTruthy()
  })

  it('renders week, range, priority, status, note, and activity', () => {
    render(<QuarterContextCard context={ctx({ note: 'focus on PDFs', latestActivity: { kind: 'ada-audit', at: '2026-07-21T10:00:00Z' } })} />)
    expect(screen.getByText(/Week 3/)).toBeTruthy()
    expect(screen.getByText(/7\/20–7\/24/)).toBeTruthy()
    expect(screen.getByText('In Progress')).toBeTruthy()
    expect(screen.getByText('“focus on PDFs”')).toBeTruthy()
    expect(screen.getByText(/This cycle: ADA audit/)).toBeTruthy()
  })

  it('renders the done chip when completed', () => {
    render(<QuarterContextCard context={ctx({ completed: true, completedAt: '2026-07-24T10:00:00Z' })} />)
    expect(screen.getByText(/✓ Done/)).toBeTruthy()
  })
})
