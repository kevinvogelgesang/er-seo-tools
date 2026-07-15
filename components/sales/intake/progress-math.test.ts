// components/sales/intake/progress-math.test.ts
// Pure math — no jsdom, no timers, no DB. The monotonicity fixtures here are
// the contract: the bar must NEVER move backward as denominators appear.
import { describe, expect, it } from 'vitest'
import { computeAuditProgress, computeEtaLabel, type AuditProgressInput } from './progress-math'

const ZERO: AuditProgressInput = {
  status: 'running', reportable: false,
  pagesTotal: 0, pagesComplete: 0, pagesError: 0, pagesRedirected: 0,
  pdfsTotal: 0, pdfsComplete: 0, pdfsError: 0, pdfsSkipped: 0,
  lighthouseTotal: 0, lighthouseComplete: 0, lighthouseError: 0,
}
const input = (over: Partial<AuditProgressInput>): AuditProgressInput => ({ ...ZERO, ...over })

function fractionOf(p: ReturnType<typeof computeAuditProgress>): number {
  if (p.kind !== 'progress' && p.kind !== 'building-report') throw new Error(`no fraction on kind=${p.kind}`)
  return p.fraction
}

describe('computeAuditProgress — states', () => {
  it('queued → kind queued', () => {
    expect(computeAuditProgress(input({ status: 'queued' }))).toEqual({ kind: 'queued' })
  })

  it('running with pagesTotal 0 → discovering (indeterminate, no ETA)', () => {
    expect(computeAuditProgress(input({ status: 'running' }))).toEqual({ kind: 'discovering' })
  })

  it('complete && !reportable → building-report at fraction 1 (verifier window)', () => {
    expect(computeAuditProgress(input({ status: 'complete', reportable: false, pagesTotal: 5, pagesComplete: 5 })))
      .toEqual({ kind: 'building-report', fraction: 1 })
  })

  it('complete && reportable → none; error → none; cancelled → none', () => {
    expect(computeAuditProgress(input({ status: 'complete', reportable: true, pagesTotal: 5, pagesComplete: 5 })).kind).toBe('none')
    expect(computeAuditProgress(input({ status: 'error' })).kind).toBe('none')
    expect(computeAuditProgress(input({ status: 'cancelled' })).kind).toBe('none')
  })
})

describe('computeAuditProgress — weighted fraction (pages 70 / pdfs 15 / lh 15)', () => {
  it('mid-pages: f = 0.7 × settled/total, with pagesRedirected counted as settled (finalizer semantics)', () => {
    const p = computeAuditProgress(input({
      status: 'running', pagesTotal: 10, pagesComplete: 2, pagesError: 1, pagesRedirected: 1,
    }))
    expect(p.kind).toBe('progress')
    expect(fractionOf(p)).toBeCloseTo(0.7 * 0.4, 10)
    if (p.kind === 'progress') expect(p.phaseLabel).toBe('Scanning pages (4/10)')
  })

  it('mid-pages: PDF/LH weights are RESERVED — growing pdf totals never move the bar', () => {
    const before = computeAuditProgress(input({
      status: 'running', pagesTotal: 10, pagesComplete: 4, pdfsTotal: 5, pdfsComplete: 2,
    }))
    const after = computeAuditProgress(input({
      status: 'running', pagesTotal: 10, pagesComplete: 4, pdfsTotal: 10, pdfsComplete: 2,
    }))
    expect(fractionOf(before)).toBeCloseTo(0.28, 10)
    expect(fractionOf(after)).toBeCloseTo(0.28, 10) // denominator grew, fraction did not move
  })

  it('pages done: pdf phase contributes, skipped counts as settled', () => {
    const p = computeAuditProgress(input({
      status: 'pdfs-running', pagesTotal: 10, pagesComplete: 6, pagesError: 2, pagesRedirected: 2,
      pdfsTotal: 4, pdfsComplete: 1, pdfsError: 0, pdfsSkipped: 1,
      lighthouseTotal: 10, lighthouseComplete: 0,
    }))
    // active weight 1.0 → 0.7 + 0.15×(2/4) + 0.15×0
    expect(fractionOf(p)).toBeCloseTo(0.775, 10)
    if (p.kind === 'progress') expect(p.phaseLabel).toBe('Scanning PDFs (2/4)')
  })

  it('zero-total phase redistributes its weight ONLY once pages are done', () => {
    const p = computeAuditProgress(input({
      status: 'lighthouse-running', pagesTotal: 10, pagesComplete: 10,
      pdfsTotal: 0, lighthouseTotal: 8, lighthouseComplete: 4,
    }))
    // pdf weight folds away: (0.7 + 0.15×0.5) / 0.85
    expect(fractionOf(p)).toBeCloseTo(0.775 / 0.85, 10)
    if (p.kind === 'progress') expect(p.phaseLabel).toBe('Running Lighthouse (4/8)')
  })

  it('pages done with BOTH follow-up phases empty → fraction 1 (finalizer about to flip)', () => {
    const p = computeAuditProgress(input({ status: 'running', pagesTotal: 10, pagesComplete: 10 }))
    expect(fractionOf(p)).toBe(1)
    if (p.kind === 'progress') expect(p.phaseLabel).toBe('Finishing up…')
  })

  it('never moves backward across the pages→pdfs transition', () => {
    const preDone = computeAuditProgress(input({
      status: 'running', pagesTotal: 10, pagesComplete: 9, pdfsTotal: 6, pdfsComplete: 6,
    }))
    const postDone = computeAuditProgress(input({
      status: 'pdfs-running', pagesTotal: 10, pagesComplete: 10, pdfsTotal: 6, pdfsComplete: 6,
      lighthouseTotal: 5, lighthouseComplete: 0,
    }))
    expect(fractionOf(preDone)).toBeLessThanOrEqual(0.7)
    expect(fractionOf(postDone)).toBeGreaterThanOrEqual(0.7)
    expect(fractionOf(postDone)).toBeGreaterThanOrEqual(fractionOf(preDone))
  })

  it('clamps over-settled counters to 1 per phase', () => {
    const p = computeAuditProgress(input({
      status: 'running', pagesTotal: 10, pagesComplete: 9, pagesError: 2, pagesRedirected: 1, // 12 settled of 10
    }))
    expect(fractionOf(p)).toBeLessThanOrEqual(1)
  })
})

describe('computeEtaLabel — elapsed × (1−f)/f from startedAt', () => {
  const T0 = Date.parse('2026-07-14T10:00:00.000Z')
  const started = '2026-07-14T10:00:00.000Z'

  it('null while startedAt is null (long queue wait: never estimate from queue time)', () => {
    expect(computeEtaLabel({ fraction: 0.5, startedAt: null, now: T0 + 600_000 })).toBeNull()
  })

  it('null at fraction 1 (nothing remaining)', () => {
    expect(computeEtaLabel({ fraction: 1, startedAt: started, now: T0 + 600_000 })).toBeNull()
  })

  it('"estimating…" below the f≥0.05 gate', () => {
    expect(computeEtaLabel({ fraction: 0.04, startedAt: started, now: T0 + 60_000 })).toBe('estimating…')
  })

  it('"estimating…" below the 20 s elapsed gate', () => {
    expect(computeEtaLabel({ fraction: 0.5, startedAt: started, now: T0 + 19_000 })).toBe('estimating…')
  })

  it('formats "~N min remaining" (f=0.5 after 10 min → ~10 min)', () => {
    expect(computeEtaLabel({ fraction: 0.5, startedAt: started, now: T0 + 600_000 })).toBe('~10 min remaining')
  })

  it('floors at "~1 min remaining"', () => {
    // f=0.9 after 5 min → remaining ≈ 33 s
    expect(computeEtaLabel({ fraction: 0.9, startedAt: started, now: T0 + 300_000 })).toBe('~1 min remaining')
  })

  it('caps at "> 30 min remaining"', () => {
    // f=0.05 after 2 min → remaining = 38 min
    expect(computeEtaLabel({ fraction: 0.05, startedAt: started, now: T0 + 120_000 })).toBe('> 30 min remaining')
  })

  it('null on an unparseable startedAt (defensive)', () => {
    expect(computeEtaLabel({ fraction: 0.5, startedAt: 'not-a-date', now: T0 })).toBeNull()
  })
})
