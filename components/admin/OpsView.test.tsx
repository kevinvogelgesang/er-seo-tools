// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { OpsView } from './OpsView'
import type { OpsSnapshot } from '@/lib/ops/ops-snapshot'

afterEach(cleanup)

const base: OpsSnapshot = {
  queue: { ok: true, data: { counts: { psi: { complete: 3, error: 1 } }, oldestRunning: null, recentFailures: [] } },
  cleanup: { ok: true, data: [{ type: 'cleanup', lastCompletedAt: null, lastStatus: null, lastError: null }] },
  health: { ok: true, data: { degraded: false, signals: { newErroredSiteAudits: 0, newErroredAdaAudits: 0, newExhaustedJobs: 0, erroredSiteAuditDetails: [], erroredAdaAuditDetails: [], exhaustedJobDetails: [], stalledAudit: null, newestBackupAgeHours: 2 } } },
  disk: { ok: true, data: 5_000_000_000 },
  dbSize: { ok: true, data: 456_000_000 },
  pool: { ok: true, data: { poolSize: 2, inUse: 1, free: 1, waiting: 0, draining: false, browserAlive: true, pagesServed: 9 } },
}

describe('OpsView', () => {
  it('renders the queue counts and pool state', () => {
    render(<OpsView snapshot={base} />)
    expect(screen.getByText(/psi/i)).toBeTruthy()
    expect(screen.getByText(/pages served/i)).toBeTruthy()
  })

  it('shows "—" for a null metric', () => {
    render(<OpsView snapshot={{ ...base, disk: { ok: true, data: null } }} />)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows "unavailable" for a failed section', () => {
    render(<OpsView snapshot={{ ...base, health: { ok: false } }} />)
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
  })

  it('renders a failed System metric as "unavailable", not "—"', () => {
    render(<OpsView snapshot={{ ...base, disk: { ok: false } }} />)
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
  })
})
