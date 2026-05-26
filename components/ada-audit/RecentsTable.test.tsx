// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import RecentsTable from './RecentsTable'
import type { RecentItem } from '@/lib/ada-audit/recents-query'

const item: RecentItem = {
  type: 'page', id: 'a1', createdAt: '2026-05-13T00:00:00.000Z', url: 'https://x.com',
  status: 'complete', score: 90, startedAt: '2026-05-13T00:00:00.000Z',
  completedAt: '2026-05-13T00:01:00.000Z', clientName: 'Acme', requestedBy: 'Alice',
}

describe('RecentsTable', () => {
  it('renders an Operator column with the requestedBy value', () => {
    render(<RecentsTable initialItems={[item]} initialScope="all" operator="Alice" variant="full" />)
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('Operator')).toBeTruthy()
  })
  it('home variant shows the See all footer link', () => {
    render(<RecentsTable initialItems={[item]} initialScope="mine" operator="Alice" variant="home" />)
    expect(screen.getByText(/See all recents/i)).toBeTruthy()
  })
})
