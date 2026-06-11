// @vitest-environment jsdom
// components/clients/FleetTable.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { FleetTable, type FleetTableRow } from './FleetTable'

const series = (latest: number | null, delta: number | null) => ({
  latest, previous: null, delta, latestAt: latest !== null ? '2026-06-10T00:00:00.000Z' : null, points: [],
})

const row = (over: Partial<FleetTableRow>): FleetTableRow => ({
  id: 1, name: 'Acme College', firstDomain: 'acme.example',
  seo: series(90, 5), ada: series(80, null), adaSource: 'site',
  pillarScore: 7, pillarAt: '2026-06-01T00:00:00.000Z',
  lastActivityAt: '2026-06-10T00:00:00.000Z', alerts: [],
  openCritical: null, openWarning: null, ...over,
})

describe('FleetTable', () => {
  it('renders client rows with scores and dashboard links', () => {
    render(<FleetTable rows={[row({})]} />)
    expect(screen.getByText('Acme College')).toBeTruthy()
    expect(screen.getByText('90')).toBeTruthy()
    const link = screen.getByText('Acme College').closest('a')
    expect(link?.getAttribute('href')).toBe('/clients/1')
  })
  it('renders em-dash for missing scores, never 0', () => {
    render(<FleetTable rows={[row({ id: 2, name: 'Empty Co', seo: series(null, null), ada: series(null, null), adaSource: null, pillarScore: null })]} />)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })
  it('renders alert chips', () => {
    render(<FleetTable rows={[row({ id: 3, name: 'Bad Co', alerts: [{ kind: 'error', detail: 'SEO parse: latest run failed' }, { kind: 'stale', detail: 'no completed activity in 30+ days' }] })]} />)
    expect(screen.getByText('error')).toBeTruthy()
    expect(screen.getByText('stale')).toBeTruthy()
  })
  it('shows the page-audit suffix on the ADA cell', () => {
    render(<FleetTable rows={[row({ id: 4, name: 'Page Co', adaSource: 'page', ada: series(75, null) })]} />)
    expect(screen.getByText('page')).toBeTruthy()
  })
  it('renders the empty state with a manage link', () => {
    render(<FleetTable rows={[]} />)
    expect(screen.getByText(/No clients yet/)).toBeTruthy()
  })
  it('renders Issues column chips and em-dash when null', () => {
    render(<FleetTable rows={[
      row({ id: 3, name: 'Issue Co', openCritical: 3, openWarning: 7 }),
      row({ id: 4, name: 'NoData Co' }),
    ]} />)
    expect(screen.getByText('3C')).toBeTruthy()
    expect(screen.getByText('7W')).toBeTruthy()
  })
  it('renders regression alert chip', () => {
    render(<FleetTable rows={[row({ id: 5, alerts: [{ kind: 'regression', detail: '1 new critical issue type' }] })]} />)
    expect(screen.getByText('regression')).toBeTruthy()
  })
})
