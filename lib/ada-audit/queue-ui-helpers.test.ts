import { describe, it, expect } from 'vitest'
import type { QueueStatusWithBatch } from './types'
import { computeActivePhaseSummary } from './queue-ui-helpers'

type ActiveAudit = NonNullable<QueueStatusWithBatch['active']>

function makeActive(parts: Partial<ActiveAudit>): ActiveAudit {
  return {
    id: 'a-1',
    domain: 'example.com',
    status: 'running',
    pagesTotal: 0,
    pagesComplete: 0,
    pagesError: 0,
    pdfsTotal: 0,
    pdfsComplete: 0,
    pdfsError: 0,
    lighthouseTotal: 0,
    lighthouseComplete: 0,
    lighthouseError: 0,
    clientId: null,
    ...parts,
  }
}

describe('computeActivePhaseSummary', () => {
  it('returns pages phase for status="running"', () => {
    const out = computeActivePhaseSummary(makeActive({
      status: 'running', pagesTotal: 30, pagesComplete: 12, pagesError: 0,
    }))
    expect(out).toEqual({ label: 'Scanning pages', unit: 'pages', complete: 12, total: 30, pct: 40 })
  })

  it('returns pages phase for status="pending" (fallback)', () => {
    const out = computeActivePhaseSummary(makeActive({
      status: 'pending', pagesTotal: 0, pagesComplete: 0, pagesError: 0,
    }))
    expect(out.label).toBe('Scanning pages')
    expect(out.pct).toBe(0)
  })

  it('returns pdfs phase for status="pdfs-running"', () => {
    const out = computeActivePhaseSummary(makeActive({
      status: 'pdfs-running', pdfsTotal: 10, pdfsComplete: 3, pdfsError: 1,
    }))
    expect(out).toEqual({ label: 'Scanning PDFs', unit: 'PDFs', complete: 4, total: 10, pct: 40 })
  })

  it('returns lighthouse phase for status="lighthouse-running"', () => {
    const out = computeActivePhaseSummary(makeActive({
      status: 'lighthouse-running', lighthouseTotal: 20, lighthouseComplete: 9, lighthouseError: 1,
    }))
    expect(out).toEqual({ label: 'Running Lighthouse', unit: 'pages', complete: 10, total: 20, pct: 50 })
  })

  it('returns pct=0 when total is 0 (discovery in progress)', () => {
    const out = computeActivePhaseSummary(makeActive({
      status: 'running', pagesTotal: 0, pagesComplete: 0, pagesError: 0,
    }))
    expect(out.pct).toBe(0)
    expect(out.total).toBe(0)
  })

  it('counts errored pages toward pct for pages phase', () => {
    const out = computeActivePhaseSummary(makeActive({
      status: 'running', pagesTotal: 10, pagesComplete: 5, pagesError: 3,
    }))
    // complete+error = 8, of 10 = 80%
    expect(out.complete).toBe(8)
    expect(out.pct).toBe(80)
  })
})
