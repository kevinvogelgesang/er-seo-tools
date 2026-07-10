// lib/findings/seo-mapper.test.ts
import { describe, it, expect } from 'vitest'
import type { AggregatedResult } from '@/lib/types'
import { computeHealthScore } from '@/lib/services/scoring.service'
import { DEFAULT_WEIGHTS } from '@/lib/scoring/weights'
import { mapSeoResult } from './seo-mapper'
import { runFindingKey, pageFindingKey } from './keys'

const CTX = {
  sessionId: 'sess-1',
  clientId: 7,
  startedAt: new Date('2026-06-10T00:00:00Z'),
  completedAt: new Date('2026-06-10T00:05:00Z'),
  weights: DEFAULT_WEIGHTS,
}

/** Minimal current-format AggregatedResult: 2 pages, 1 critical issue with
 *  complete refs, 1 warning with sample urls only (no refs), 1 notice with
 *  an external URL not in the page index. */
function fixture(): AggregatedResult {
  return {
    crawl_summary: { total_urls: 2 },
    issues: {
      critical: [{
        type: 'broken_pages', severity: 'critical', count: 1,
        description: 'Pages returning 4xx/5xx',
        affectedUrlRefs: [0], affectedUrlRefsComplete: true,
        affectedUrlSource: 'parser-complete',
      }],
      warnings: [{
        type: 'missing_meta_description', severity: 'warning', count: 2,
        description: 'Missing meta descriptions',
        urls: ['https://Example.com/a#frag'],
        affectedUrlSource: 'parser-sample',
      }],
      notices: [{
        type: 'external_broken_link', severity: 'notice', count: 1,
        description: 'External link broken',
        urls: ['https://other-site.org/gone'],
      }],
    },
    site_structure: {}, resources: {}, technical_seo: {}, performance: {},
    recommendations: [],
    metadata: {
      files_processed: [], parsers_used: [], total_parsers_available: 41,
      site_name: 'Example.com', health_score: 83,
    },
    url_registry: {
      sessionOrigin: { scheme: 'https', host: 'example.com' },
      hosts: ['example.com'],
      urls: [
        { id: 0, kind: 'page', hostId: 0, scheme: 'https', path: '/a' },
        { id: 1, kind: 'page', hostId: 0, scheme: 'https', path: '/' },
      ],
    },
    page_index: [
      { ref: 0, title: 'A', h1: 'A1', metaDescription: null, wordCount: 100, crawlDepth: 1, indexable: true, issueTypes: ['broken_pages', 'missing_meta_description'] },
      { ref: 1, title: 'Home', h1: null, metaDescription: 'd', wordCount: 500, crawlDepth: 0, indexable: true, issueTypes: [] },
    ],
  } as unknown as AggregatedResult
}

describe('mapSeoResult', () => {
  it('builds the run with origin, score, domain, pagesTotal', () => {
    const b = mapSeoResult(fixture(), CTX)
    expect(b.run.tool).toBe('seo-parser')
    expect(b.run.source).toBe('sf-upload')
    expect(b.run.sessionId).toBe('sess-1')
    expect(b.run.siteAuditId).toBeNull()
    expect(b.run.adaAuditId).toBeNull()
    expect(b.run.clientId).toBe(7)
    expect(b.run.score).toBe(computeHealthScore(fixture(), DEFAULT_WEIGHTS).score)
    expect(b.run.domain).toBe('example.com')
    expect(b.run.status).toBe('complete')
    expect(b.run.pagesTotal).toBe(2)
  })

  it('persists a v2 scoreBreakdown with a weightsHash and the SF inputsSnapshot', () => {
    const b = mapSeoResult(fixture(), CTX)
    const parsed = JSON.parse(b.run.scoreBreakdown!)
    expect(parsed).toMatchObject({ version: 2, scorer: 'health', score: b.run.score })
    expect(parsed.weightsHash).toMatch(/^[0-9a-f]{12}$/)
    expect(parsed.inputsSnapshot).toEqual({
      source: 'sf',
      totalUrls: 2,
      indexableUrls: 0,
      clientErrors: 0,
      serverErrors: 0,
      base: 2,
      missingTitle: 0,
      missingMeta: 2,
      missingH1: 0,
      avgCrawlDepth: null,
      thinCount: null,
      pagesWithSchema: null,
      indexableKnown: false,
      errorsKnown: false,
    })
  })

  it('builds one CrawlPage per page_index entry with normalized urls', () => {
    const b = mapSeoResult(fixture(), CTX)
    expect(b.pages).toHaveLength(2)
    const urls = b.pages.map((p) => p.url).sort()
    expect(urls).toEqual(['https://example.com', 'https://example.com/a'])
    const a = b.pages.find((p) => p.url === 'https://example.com/a')!
    expect(a.title).toBe('A')
    expect(a.runId).toBe(b.run.id)
    expect(a.status).toBeNull()
  })

  it('builds one run-scope finding per issue with completeness flags', () => {
    const b = mapSeoResult(fixture(), CTX)
    const runScope = b.findings.filter((f) => f.scope === 'run')
    expect(runScope).toHaveLength(3)
    const broken = runScope.find((f) => f.type === 'broken_pages')!
    expect(broken.severity).toBe('critical')
    expect(broken.count).toBe(1)
    expect(broken.affectedComplete).toBe(true)
    expect(broken.affectedSource).toBe('parser-complete')
    expect(broken.dedupKey).toBe(runFindingKey('broken_pages'))
    expect(broken.pageId).toBeNull()
    const meta = runScope.find((f) => f.type === 'missing_meta_description')!
    expect(meta.affectedComplete).toBeNull() // flag absent in blob → null, not false
    expect(meta.affectedSource).toBe('parser-sample')
  })

  it('computes the score directly, ignoring any legacy metadata.health_score', () => {
    // C8 drops the metadata.health_score precedence entirely — the mapper
    // always computes the score itself, even when a legacy blob carries one.
    const fx = fixture()
    delete (fx.metadata as Record<string, unknown>).health_score
    const b = mapSeoResult(fx, CTX)
    expect(b.run.score).toBe(computeHealthScore(fx, DEFAULT_WEIGHTS).score)
    expect(typeof b.run.score).toBe('number')
  })

  it('page-scope rows carry the completeness flags of their issue', () => {
    const fx = fixture()
    // current-format sampled issue: refs present but explicitly incomplete
    fx.issues.warnings[0].affectedUrlRefs = [0]
    fx.issues.warnings[0].affectedUrlRefsComplete = false
    const b = mapSeoResult(fx, CTX)
    const metaPage = b.findings.find(
      (f) => f.scope === 'page' && f.type === 'missing_meta_description',
    )!
    expect(metaPage.affectedComplete).toBe(false)
    expect(metaPage.affectedSource).toBe('parser-sample')
  })

  it('extracts page-scope URLs from groups[*].urls (duplicate-content shape)', () => {
    // duplicate title/meta/H1 issues carry URLs in groups, NOT in
    // issue.urls/affectedUrlRefs (same gap recommendation-builder fixed).
    const fx = fixture()
    fx.issues.warnings.push({
      type: 'duplicate_titles', severity: 'warning', count: 2,
      description: 'Duplicate titles',
      groups: [{ title: 'A', count: 2, urls: ['https://example.com/a', 'https://example.com/'] }],
    } as never)
    const b = mapSeoResult(fx, CTX)
    const dup = b.findings.filter((f) => f.scope === 'page' && f.type === 'duplicate_titles')
    expect(dup).toHaveLength(2)
    expect(dup.map((f) => f.url).sort()).toEqual(['https://example.com', 'https://example.com/a'])
  })

  it('builds page-scope findings from refs, sample urls, and external urls', () => {
    const b = mapSeoResult(fixture(), CTX)
    const pageScope = b.findings.filter((f) => f.scope === 'page')
    expect(pageScope).toHaveLength(3)

    const broken = pageScope.find((f) => f.type === 'broken_pages')!
    const pageA = b.pages.find((p) => p.url === 'https://example.com/a')!
    expect(broken.pageId).toBe(pageA.id)
    expect(broken.url).toBe('https://example.com/a')
    expect(broken.dedupKey).toBe(pageFindingKey('broken_pages', 'https://example.com/a'))

    // sample url resolves to the same page via normalization
    const meta = pageScope.find((f) => f.type === 'missing_meta_description')!
    expect(meta.pageId).toBe(pageA.id)

    // external URL: page-scope, pageId null, url kept
    const ext = pageScope.find((f) => f.type === 'external_broken_link')!
    expect(ext.pageId).toBeNull()
    expect(ext.url).toBe('https://other-site.org/gone')
  })

  it('emits no violations and dedupes repeated (type,url) pairs', () => {
    const fx = fixture()
    // duplicate the same affected ref to force a would-be dedup collision
    fx.issues.critical[0].affectedUrlRefs = [0, 0]
    const b = mapSeoResult(fx, CTX)
    expect(b.violations).toHaveLength(0)
    const keys = b.findings.map((f) => f.dedupKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('dedupes page_index entries that normalize to the same URL (keep first)', () => {
    // Real production blobs can contain literal duplicate page_index entries
    // (seen on nuvani.edu: same URL under two refs) — without dedupe the
    // writer violates @@unique([runId, url]).
    const fx = fixture()
    fx.url_registry!.urls.push({ id: 2, kind: 'page', hostId: 0, scheme: 'https', path: '/a' })
    fx.page_index!.push({
      ref: 2, title: 'A-dup', h1: null, metaDescription: null,
      wordCount: 1, crawlDepth: 9, indexable: false, issueTypes: [],
    })
    const b = mapSeoResult(fx, CTX)
    expect(b.pages).toHaveLength(2)
    expect(b.run.pagesTotal).toBe(2)
    const a = b.pages.find((p) => p.url === 'https://example.com/a')!
    expect(a.title).toBe('A') // first entry wins
  })

  it('legacy blob without page_index/url_registry → run-scope rows only', () => {
    const fx = fixture()
    delete (fx as Record<string, unknown>).url_registry
    delete (fx as Record<string, unknown>).page_index
    const b = mapSeoResult(fx, CTX)
    expect(b.pages).toHaveLength(0)
    expect(b.run.pagesTotal).toBe(0)
    expect(b.findings.every((f) => f.scope === 'run')).toBe(true)
    // sample urls exist but cannot be page rows; still no page-scope rows
    expect(b.findings).toHaveLength(3)
  })
})
