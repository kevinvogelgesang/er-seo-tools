// lib/findings/ada-mapper.test.ts
import { describe, it, expect } from 'vitest'
import type { AxeViolation, StoredAxeResults } from '@/lib/ada-audit/types'
import { computeScoreV2 } from '@/lib/ada-audit/scoring-v2'
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

  it('computes the run score (v2) as the mean of per-page v2 scores — single page here, so run.score === page.score', () => {
    const violations = [violation(), violation({ id: 'image-alt', impact: 'critical' })]
    const b = mapAdaChildren(PARENT, [
      child({ result: axeBlob(violations) }),
    ])
    const expected = computeScoreV2({
      violations, incompleteCount: 0, domElementCount: null, wcagLevel: 'wcag21aa',
    }).score
    expect(b.run.score).toBe(expected)
    expect(b.pages[0].score).toBe(expected)
    expect(JSON.parse(b.run.scoreBreakdown as string).version).toBe(2)
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
    expect(ok.score).toBe(
      computeScoreV2({ violations: [violation()], incompleteCount: 0, domElementCount: null, wcagLevel: 'wcag21aa' }).score,
    )
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

  it('null impact → severity notice, Violation.impact "unknown", still weighted (as IMPACT_WEIGHT.null) into the v2 score', () => {
    const violations = [violation({ id: 'odd-rule', impact: null })]
    const b = mapAdaChildren(PARENT, [
      child({ result: axeBlob(violations) }),
    ])
    expect(b.findings[0].severity).toBe('notice')
    expect(b.violations[0].impact).toBe('unknown')
    // v2 (unlike v1) does not exclude null-impact violations from scoring —
    // they carry IMPACT_WEIGHT.null (1) — so this is NOT the same as a
    // clean-page (100) score.
    const expected = computeScoreV2({
      violations, incompleteCount: 0, domElementCount: null, wcagLevel: 'wcag21aa',
    }).score
    expect(b.run.score).toBe(expected)
    expect(b.run.score).toBeLessThan(100)
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

  it('site run gets null score AND null scoreBreakdown when no page is scored (all children errored/non-complete)', () => {
    const b = mapAdaChildren({ ...PARENT, pagesError: 2 }, [
      child({ status: 'error', error: 'timeout', result: null }),
      child({ id: 'child-2', url: 'https://mapper.test/old', status: 'redirected', finalUrl: 'https://mapper.test/new', result: null }),
    ])
    expect(b.run.score).toBeNull()
    expect(b.run.scoreBreakdown).toBeNull()
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
    const expectedScore = computeScoreV2({
      violations: [violation()], incompleteCount: 0, domElementCount: null, wcagLevel: 'wcag22aa',
    }).score
    expect(b.run.score).toBe(expectedScore)
    expect(b.pages).toHaveLength(1)
    expect(b.pages[0].url).toBe('https://www.single.test/page')
    expect(b.pages[0].adaAuditId).toBe('ada-1')
    expect(b.pages[0].score).toBe(expectedScore)
    expect(b.findings).toHaveLength(1)
    expect(b.violations).toHaveLength(1)
    expect(b.run.scoreBreakdown).toBeTruthy()
    expect(JSON.parse(b.run.scoreBreakdown as string).version).toBe(2)
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

describe('passCount/incompleteCount (C3)', () => {
  function blobWithCounts(passes: number, incomplete: number): string {
    return JSON.stringify({
      violations: [],
      passes: Array.from({ length: passes }, (_, i) => ({ id: `p${i}`, help: '', nodes: [] })),
      incomplete: Array.from({ length: incomplete }, (_, i) => ({ id: `i${i}`, help: '', impact: null, nodes: [] })),
      inapplicable: [],
      timestamp: '2026-06-10T00:00:00Z', url: 'https://x.test/',
      testEngine: { name: 'axe-core', version: '4.10' },
      testRunner: { name: 'er-seo-tools' },
    })
  }

  it('stamps passCount/incompleteCount from the blob on complete pages', () => {
    const b = mapAdaChildren(PARENT, [
      child({ id: 'c1', url: 'https://mapper.test/counts', result: blobWithCounts(2, 1) }),
    ])
    expect(b.pages[0].passCount).toBe(2)
    expect(b.pages[0].incompleteCount).toBe(1)
  })

  it('leaves counts null on error/redirected/malformed pages', () => {
    const b = mapAdaChildren(PARENT, [
      child({ id: 'c1', url: 'https://mapper.test/err', status: 'error', error: 'boom', result: null }),
      child({ id: 'c2', url: 'https://mapper.test/bad', status: 'complete', result: '{not json' }),
      child({ id: 'c3', url: 'https://mapper.test/redir', status: 'redirected', finalUrl: 'https://mapper.test/', result: null }),
    ])
    expect(b.pages[0].passCount).toBeNull()
    expect(b.pages[0].incompleteCount).toBeNull()
    expect(b.pages[1].passCount).toBeNull()
    expect(b.pages[1].incompleteCount).toBeNull()
    expect(b.pages[2].passCount).toBeNull()
  })

  it('missing passes/incomplete arrays in the blob default to 0, not null', () => {
    const b = mapAdaChildren(PARENT, [
      child({ id: 'c1', url: 'https://mapper.test/sparse', result: JSON.stringify({ violations: [] }) }),
    ])
    expect(b.pages[0].passCount).toBe(0)
    expect(b.pages[0].incompleteCount).toBe(0)
  })

  it('mapAdaSingle stamps counts', () => {
    const b = mapAdaSingle({
      id: 'ada-c3', url: 'https://single.test/counts', status: 'complete',
      result: blobWithCounts(1, 0), finalUrl: null, wcagLevel: 'wcag21aa',
      clientId: null, startedAt: null, completedAt: null,
    })
    expect(b.pages[0].passCount).toBe(1)
    expect(b.pages[0].incompleteCount).toBe(0)
  })
})

describe('ada-mapper v2 scoring', () => {
  it('writes a version-2 scoreBreakdown on the standalone run', () => {
    const result = JSON.stringify({
      violations: [{ id: 'image-alt', impact: 'serious', help: '', description: '', helpUrl: '',
        tags: ['wcag2a'], nodes: [{ html: '<img>' }], nodeCount: 12 }],
      passes: [], incomplete: [], inapplicable: [], domElementCount: 800,
      timestamp: '', url: 'https://x.test/', testEngine: { name: '', version: '' }, testRunner: { name: '' },
    })
    const bundle = mapAdaSingle({ id: 'a1', url: 'https://x.test/', status: 'complete', result,
      finalUrl: null, wcagLevel: 'wcag21aa', clientId: null, startedAt: null, completedAt: null })
    expect(bundle.run.scoreBreakdown).toBeTruthy()
    const b = JSON.parse(bundle.run.scoreBreakdown as string)
    expect(b.version).toBe(2)
    expect(b.scorer).toBe('ada-v2')
    expect(bundle.run.score).toBe(bundle.pages[0].score)
  })

  it('site run score is the mean of per-page v2 scores', () => {
    const mk = (id: string, url: string, nodeCount: number) => ({
      id, url, status: 'complete', error: null, finalUrl: null,
      result: JSON.stringify({ violations: nodeCount ? [{ id: 'image-alt', impact: 'serious',
        help: '', description: '', helpUrl: '', tags: ['wcag2a'], nodes: [{ html: '<img>' }], nodeCount }] : [],
        passes: [], incomplete: [], inapplicable: [], domElementCount: 1000,
        timestamp: '', url, testEngine: { name: '', version: '' }, testRunner: { name: '' } }),
    })
    const parent = { id: 's1', domain: 'x.test', clientId: null, wcagLevel: 'wcag21aa',
      pagesError: 0, startedAt: null, completedAt: null }
    const bundle = mapAdaChildren(parent, [mk('c1', 'https://x.test/a', 0), mk('c2', 'https://x.test/b', 40)])
    const pageScores = bundle.pages.map((p) => p.score!).filter((s) => s != null)
    const mean = Math.round(pageScores.reduce((a, b) => a + b, 0) / pageScores.length)
    expect(bundle.run.score).toBe(mean)
    expect(JSON.parse(bundle.run.scoreBreakdown as string).version).toBe(2)
  })
})
