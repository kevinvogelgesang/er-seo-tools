// @vitest-environment jsdom
// components/clients/ActivityTimeline.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ActivityTimeline, type ActivityTimelineItem } from './ActivityTimeline'

const item = (over: Partial<ActivityTimelineItem>): ActivityTimelineItem => ({
  type: 'seo-parse', id: 'x1', title: 'acme.example', status: 'complete',
  date: '2026-06-10T00:00:00.000Z', href: '/seo-audits/results/x1', stat: '100 URLs · 5 critical', ...over,
})

describe('ActivityTimeline', () => {
  it('renders tool badge, status badge, stat and link', () => {
    render(<ActivityTimeline items={[item({})]} />)
    expect(screen.getByText('SEO Parse')).toBeTruthy()
    expect(screen.getByText('complete')).toBeTruthy()
    expect(screen.getByText('100 URLs · 5 critical')).toBeTruthy()
    expect(screen.getByText('acme.example').closest('a')?.getAttribute('href')).toBe('/seo-audits/results/x1')
  })
  it('error status gets the red badge classes', () => {
    render(<ActivityTimeline items={[item({ id: 'x2', status: 'error' })]} />)
    expect(screen.getByText('error').className).toContain('red')
  })
  it('renders the empty state', () => {
    render(<ActivityTimeline items={[]} />)
    expect(screen.getByText(/No activity yet/)).toBeTruthy()
  })
})
