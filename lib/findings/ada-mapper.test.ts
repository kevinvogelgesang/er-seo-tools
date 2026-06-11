// lib/findings/ada-mapper.test.ts
import { describe, it, expect } from 'vitest'
import type { AxeViolation, StoredAxeResults } from '@/lib/ada-audit/types'
import { computeScore, computeScoreFromCounts } from '@/lib/ada-audit/scoring'
import { mapAdaChildren, mapAdaSingle, mapImpactToSeverity } from './ada-mapper'
import { pageFindingKey } from './keys'

function violation(over: Partial<AxeViolation> = {}): AxeViolation {
  return {
    id: 'color-contrast',
    impact: 'serious',
    help: 'Elements must meet color contrast',
    description: 'Ensures contrast',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
    tags: ['wcag2aa', 'wcag143'],
    nodes: [
      { html: '<a class="x">low</a>', target: ['a.x'] },
      { html: '<p class="y">low</p>', target: ['p.y'] },
    ],
    ...over,
  }
}

function axeBlob(violations: AxeViolation[]): string {
  const blob: StoredAxeResults = {
    violations,
    passes: [], incomplete: [], inapplicable: [],
    timestamp: '2026-06-10T00:00:00Z', url: 'https://x.test/',
    testEngine: { name: 'axe-core', version: '4.10' },
    testRunner: { name: 'er-seo-tools' },
  }
  return JSON.stringify(blob)
}

const PARENT = {
  id: 'site-1',
  domain: 'www.Mapper.test',
  clientId: 7,
  wcagLevel: 'wcag21aa',
  pagesError: 0,
  startedAt: new Date('2026-06-10T00:00:00Z'),
  completedAt: new Date('2026-06-10T00:10:00Z'),
}

function child(over: Partial<{
  id: string; url: string; status: string; error: string | null
  finalUrl: string | null; result: string | null
}> = {}) {
  return {
    id: 'child-1', url: 'https://mapper.test/a', status: 'complete',
    error: null, finalUrl: null, result: axeBlob([violation()]),
    ...over,
  }
}

describe('mapImpactToSeverity', () => {
  it('maps the four impacts and null', () => {
    expect(mapImpactToSeverity('critical')).toBe('critical')
    expect(mapImpactToSeverity('serious')).toBe('critical')
    expect(mapImpactToSeverity('moderate')).toBe('warning')
    expect(mapImpactToSeverity('minor')).toBe('notice')
    expect(mapImpactToSeverity(null)).toBe('notice')
  })
})

describe('mapAdaChildren', () => {
  it('builds the run with origin, wcagLevel, normalized domain, pagesTotal', () => {
    const b = mapAdaChildren(PARENT, [child()])
    expect(b.run.tool).toBe('ada-audit')
    expect(b.run.source).toBe('site-audit')
    expect(b.run.siteAuditId).toBe('site-1')
    expect(b.run.sessionId).toBeNull()
    expect(b.run.adaAuditId).toBeNull()
    expect(b.run.clientId).toBe(7)
    expect(b.run.wcagLevel).toBe('wcag21aa')
    expect(b.run.domain).toBe('mapper.test') // www stripped, lowercased
    expect(b.run.status).toBe('complete')
    expect(b.run.pagesTotal).toBe(1)
    expect(b.run.startedAt).toEqual(PARENT.startedAt)
    expect(b.run.completedAt).toEqual(PARENT.completedAt)
  })

  it('marks the run partial when the parent has errored pages', () => {
    const b = mapAdaChildren({ ...PARENT, pagesError: 1 }, [
      child(),
      child({ id: 'child-2', url: 'https://mapper.test/b', status: 'error', error: 'timeout', result: null }),
    ])
    expect(b.run.status).toBe('partial')
  })

  it('computes the run score from stored violation counts via computeScoreFromCounts', () => {
    const b = mapAdaChildren(PARENT, [
      child({ result: axeBlob([violation(), violation({ id: 'image-alt', impact: 'critical' })]) }),
    ])
    expect(b.run.score).toBe(
      computeScoreFromCounts({ critical: 1, serious: 1, moderate: 0, minor: 0 }, 'wcag21aa').score,
    )
  })

  it('builds one CrawlPage per child with status, error, finalUrl, adaAuditId', () => {
    const b = mapAdaChildren(PARENT, [
      child(),
      child({ id: 'child-2', url: 'https://mapper.test/gone', status: 'error', error: 'nav timeout', result: null }),
      child({ id: 'child-3', url: 'https://mapper.test/old', status: 'redirected', finalUrl: 'https://mapper.test/new', result: null }),
    ])
    expect(b.pages).toHaveLength(3)
    const ok = b.pages.find((p) => p.url === 'https://mapper.test/a')!
    expect(ok.status).toBe('complete')
    expect(ok.adaAuditId).toBe('child-1')
    expect(ok.score).toBe(computeScore([violation()], 'wcag21aa').score)
    const err = b.pages.find((p) => p.url === 'https://mapper.test/gone')!
    expect(err.status).toBe('error')
    expect(err.error).toBe('nav timeout')
    expect(err.score).toBeNull()
    const redir = b.pages.find((p) => p.url === 'https://mapper.test/old')!
    expect(redir.status).toBe('redirected')
    expect(redir.finalUrl).toBe('https://mapper.test/new')
  })

  it('errored and redirected children get no findings', () => {
    const b = mapAdaChildren(PARENT, [
      child({ status: 'error', error: 'x', result: null }),
      child({ id: 'child-2', url: 'https://mapper.test/old', status: 'redirected', finalUrl: 'https://mapper.test/new' }),
    ])
    expect(b.findings).toHaveLength(0)
    expect(b.violations).toHaveLength(0)
  })

  it('builds a page-scope Finding + 1:1 Violation per axe violation', () => {
    const b = mapAdaChildren(PARENT, [child()])
    expect(b.findings).toHaveLength(1)
    expect(b.violations).toHaveLength(1)
    const f = b.findings[0]
    const page = b.pages[0]
    expect(f.scope).toBe('page')
    expect(f.type).toBe('color-contrast')
    expect(f.severity).toBe('critical') // serious → critical
    expect(f.pageId).toBe(page.id)
    expect(f.url).toBe('https://mapper.test/a')
    expect(f.dedupKey).toBe(pageFindingKey('color-contrast', 'https://mapper.test/a'))
    const v = b.violations[0]
    expect(v.findingId).toBe(f.id)
    expect(v.runId).toBe(b.run.id)
    expect(v.pageId).toBe(page.id)
    expect(v.ruleId).toBe('color-contrast')
    expect(v.impact).toBe('serious') // exact axe impact preserved
    expect(JSON.parse(v.wcagTags)).toEqual(['wcag2aa', 'wcag143'])
    expect(v.help).toBe('Elements must meet color contrast')
    expect(v.nodeCount).toBe(2)
  })

  it('null impact → severity notice, Violation.impact "unknown", excluded from score counts', () => {
    const b = mapAdaChildren(PARENT, [
      child({ result: axeBlob([violation({ id: 'odd-rule', impact: null })]) }),
    ])
    expect(b.findings[0].severity).toBe('notice')
    expect(b.violations[0].impact).toBe('unknown')
    expect(b.run.score).toBe(
      computeScoreFromCounts({ critical: 0, serious: 0, moderate: 0, minor: 0 }, 'wcag21aa').score,
    )
  })

  it('caps stored nodes at 5 with html truncated to 300 chars; nodeCount keeps the real total', () => {
    const nodes = Array.from({ length: 7 }, (_, i) => ({
      html: `<div class="n${i}">` + 'x'.repeat(400) + '</div>',
      target: [`.n${i}`],
    }))
    const b = mapAdaChildren(PARENT, [child({ result: axeBlob([violation({ nodes })]) })])
    const v = b.violations[0]
    expect(v.nodeCount).toBe(7)
    const stored = JSON.parse(v.nodes!) as { html: string; target: string[] }[]
    expect(stored).toHaveLength(5)
    expect(stored[0].html.length).toBe(300)
    expect(stored[0].target).toEqual(['.n0'])
  })

  it('keep-first dedupes children that normalize to the same URL (no findings from the loser)', () => {
    const b = mapAdaChildren(PARENT, [
      child({ url: 'https://mapper.test/' }),
      child({ id: 'child-2', url: 'https://Mapper.test', result: axeBlob([violation({ id: 'image-alt' })]) }),
    ])
    expect(b.pages).toHaveLength(1)
    expect(b.pages[0].url).toBe('https://mapper.test')
    expect(b.pages[0].adaAuditId).toBe('child-1')
    expect(b.run.pagesTotal).toBe(1)
    expect(b.findings.map((f) => f.type)).toEqual(['color-contrast'])
  })

  it('a complete child with a malformed result blob gets score null and no findings', () => {
    const b = mapAdaChildren(PARENT, [child({ result: 'not json' })])
    expect(b.pages[0].score).toBeNull()
    expect(b.findings).toHaveLength(0)
  })

  it('defensively dedupes a repeated ruleId on one page (one Finding + one Violation)', () => {
    const b = mapAdaChildren(PARENT, [
      child({ result: axeBlob([violation(), violation()]) }),
    ])
    expect(b.findings).toHaveLength(1)
    expect(b.violations).toHaveLength(1)
  })
})

describe('mapAdaSingle', () => {
  const SINGLE = {
    id: 'ada-1',
    url: 'https://www.Single.test/page',
    status: 'complete',
    result: axeBlob([violation()]),
    finalUrl: null,
    wcagLevel: 'wcag22aa',
    clientId: null,
    startedAt: new Date('2026-06-10T01:00:00Z'),
    completedAt: new Date('2026-06-10T01:02:00Z'),
  }

  it('builds a page-audit run with one page and node-based score', () => {
    const b = mapAdaSingle(SINGLE)
    expect(b.run.tool).toBe('ada-audit')
    expect(b.run.source).toBe('page-audit')
    expect(b.run.adaAuditId).toBe('ada-1')
    expect(b.run.sessionId).toBeNull()
    expect(b.run.siteAuditId).toBeNull()
    expect(b.run.domain).toBe('single.test')
    expect(b.run.wcagLevel).toBe('wcag22aa')
    expect(b.run.status).toBe('complete')
    expect(b.run.pagesTotal).toBe(1)
    const expectedScore = computeScore([violation()], 'wcag22aa').score
    expect(b.run.score).toBe(expectedScore)
    expect(b.pages).toHaveLength(1)
    expect(b.pages[0].url).toBe('https://www.single.test/page')
    expect(b.pages[0].adaAuditId).toBe('ada-1')
    expect(b.pages[0].score).toBe(expectedScore)
    expect(b.findings).toHaveLength(1)
    expect(b.violations).toHaveLength(1)
  })

  it('a redirected standalone gets a run + one redirected page, no findings, null scores', () => {
    const b = mapAdaSingle({
      ...SINGLE, status: 'redirected', result: null,
      finalUrl: 'https://single.test/final',
    })
    expect(b.run.status).toBe('complete')
    expect(b.run.score).toBeNull()
    expect(b.pages).toHaveLength(1)
    expect(b.pages[0].status).toBe('redirected')
    expect(b.pages[0].finalUrl).toBe('https://single.test/final')
    expect(b.pages[0].score).toBeNull()
    expect(b.findings).toHaveLength(0)
    expect(b.violations).toHaveLength(0)
  })
})
