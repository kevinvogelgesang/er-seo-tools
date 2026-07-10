// components/sales/intake/ProspectDashboard.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ProspectDashboard } from './ProspectDashboard'
import type { ProspectRow } from '@/lib/services/prospects'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const rows: ProspectRow[] = [
  {
    id: 1, name: 'Acme College', domain: 'acme.test', createdAt: '2026-07-09T00:00:00.000Z',
    salesTokenActive: true,
    latestAudit: { id: 'a1', status: 'complete', completedAt: '2026-07-09T01:00:00.000Z', adaScore: 62, reportable: true },
  },
  {
    id: 2, name: 'Running U', domain: 'running.test', createdAt: '2026-07-09T00:00:00.000Z',
    salesTokenActive: false,
    latestAudit: { id: 'a2', status: 'running', completedAt: null, adaScore: null, reportable: false },
  },
  {
    id: 3, name: 'Verifying U', domain: 'verifying.test', createdAt: '2026-07-09T00:00:00.000Z',
    salesTokenActive: false,
    // parent complete but live-scan run not written yet → "Report building…"
    latestAudit: { id: 'a3', status: 'complete', completedAt: '2026-07-09T01:00:00.000Z', adaScore: null, reportable: false },
  },
  { id: 4, name: 'Fresh', domain: 'fresh.test', createdAt: '2026-07-09T00:00:00.000Z', salesTokenActive: false, latestAudit: null },
]

describe('ProspectDashboard', () => {
  it('renders form, list states, and per-state actions', () => {
    render(<ProspectDashboard initialProspects={rows} />)
    expect(screen.getByLabelText(/prospect name/i)).toBeTruthy()
    expect(screen.getByLabelText(/domain/i)).toBeTruthy()
    // brief-fixture note: /scan/i matches the submit button PLUS every row's
    // Re-scan/Scan now button (guaranteed >1 with 4 rows) — getAllBy, same
    // pattern the brief already uses below for the identical ambiguity class.
    expect(screen.getAllByRole('button', { name: /scan/i }).length).toBeGreaterThan(0)
    expect(screen.getByText('Acme College')).toBeTruthy()
    expect(screen.getByRole('button', { name: /copy sales link/i })).toBeTruthy() // reportable row only
    expect(screen.getByText(/scanning/i)).toBeTruthy() // running row
    expect(screen.getByText(/report building/i)).toBeTruthy() // complete-but-not-reportable row
    expect(screen.getByText(/not scanned yet/i)).toBeTruthy() // fresh row
    expect(screen.getAllByRole('button', { name: /re-scan|scan now/i }).length).toBeGreaterThan(0)
  })
})
