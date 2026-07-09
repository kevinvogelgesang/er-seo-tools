import { describe, expect, it } from 'vitest'
import { resolveSeoOnlyView } from './seo-only-view'

describe('resolveSeoOnlyView (C16)', () => {
  it('non-seoOnly audits are untouched', () => {
    expect(resolveSeoOnlyView({ seoOnly: false, status: 'complete' }, 'r1')).toEqual({ kind: 'none' })
  })

  it('transient seoOnly audits render in place (poller branch handles them)', () => {
    for (const status of ['queued', 'pending', 'running', 'pdfs-running', 'lighthouse-running']) {
      expect(resolveSeoOnlyView({ seoOnly: true, status }, null)).toEqual({ kind: 'none' })
    }
  })

  it('error/cancelled seoOnly use the shared terminal branches', () => {
    expect(resolveSeoOnlyView({ seoOnly: true, status: 'error' }, null)).toEqual({ kind: 'none' })
    expect(resolveSeoOnlyView({ seoOnly: true, status: 'cancelled' }, null)).toEqual({ kind: 'none' })
  })

  it('complete + live-scan run → redirect to the SEO results run page', () => {
    expect(resolveSeoOnlyView({ seoOnly: true, status: 'complete' }, 'r1'))
      .toEqual({ kind: 'redirect', href: '/seo-audits/results/run/r1' })
  })

  it('complete without a run → building banner', () => {
    expect(resolveSeoOnlyView({ seoOnly: true, status: 'complete' }, null)).toEqual({ kind: 'banner' })
  })
})
