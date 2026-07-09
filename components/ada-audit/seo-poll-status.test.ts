import { describe, it, expect } from 'vitest'
import { deriveSeoOnlyStatus, isSeoOnlyTerminal } from './seo-poll-status'

describe('deriveSeoOnlyStatus', () => {
  it('passes non-complete statuses through verbatim', () => {
    for (const s of ['queued', 'pending', 'running', 'error', 'cancelled']) {
      expect(deriveSeoOnlyStatus(s, null, null)).toBe(s)
    }
  })

  it('complete + run present → seo-ready (run wins over any phase)', () => {
    expect(deriveSeoOnlyStatus('complete', 'run1', 'failed')).toBe('seo-ready')
    expect(deriveSeoOnlyStatus('complete', 'run1', null)).toBe('seo-ready')
  })

  it('complete + no run maps the verifier phase', () => {
    expect(deriveSeoOnlyStatus('complete', null, 'queued')).toBe('seo-verifying')
    expect(deriveSeoOnlyStatus('complete', null, 'running')).toBe('seo-verifying')
    expect(deriveSeoOnlyStatus('complete', null, 'failed')).toBe('seo-failed')
    expect(deriveSeoOnlyStatus('complete', null, 'unavailable')).toBe('seo-unavailable')
  })

  it('complete + no run + unknown phase (first poll not landed) → seo-verifying', () => {
    expect(deriveSeoOnlyStatus('complete', null, null)).toBe('seo-verifying')
    expect(deriveSeoOnlyStatus('complete', null, undefined)).toBe('seo-verifying')
  })
})

describe('isSeoOnlyTerminal', () => {
  it('terminal set is seo-ready/seo-failed/seo-unavailable/error/cancelled', () => {
    for (const s of ['seo-ready', 'seo-failed', 'seo-unavailable', 'error', 'cancelled']) {
      expect(isSeoOnlyTerminal(s)).toBe(true)
    }
    for (const s of ['complete', 'seo-verifying', 'running', 'queued', 'pending']) {
      expect(isSeoOnlyTerminal(s)).toBe(false)
    }
  })
})
