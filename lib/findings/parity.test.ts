// lib/findings/parity.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import type { AggregatedResult } from '@/lib/types'
import { writeSeoFindings } from './seo-write'
import { compareSeoParity } from './parity'

const SESSION_ID = 'test-findings-parity'

const RESULT = {
  crawl_summary: { total_urls: 2 },
  issues: {
    critical: [{ type: 'broken_pages', severity: 'critical', count: 1, description: 'broken', affectedUrlRefs: [0], affectedUrlRefsComplete: true }],
    warnings: [],
    notices: [{ type: 'thin_content', severity: 'notice', count: 1, description: 'thin', affectedUrlRefs: [1], affectedUrlRefsComplete: true }],
  },
  site_structure: {}, resources: {}, technical_seo: {}, performance: {},
  recommendations: [],
  metadata: { files_processed: [], parsers_used: [], total_parsers_available: 41, site_name: 'par.test', health_score: 70 },
  url_registry: {
    sessionOrigin: { scheme: 'https', host: 'par.test' },
    hosts: ['par.test'],
    urls: [
      { id: 0, kind: 'page', hostId: 0, scheme: 'https', path: '/a' },
      { id: 1, kind: 'page', hostId: 0, scheme: 'https', path: '/b' },
    ],
  },
  page_index: [
    { ref: 0, title: 'A', h1: null, metaDescription: null, wordCount: 10, crawlDepth: 1, indexable: true, issueTypes: ['broken_pages'] },
    { ref: 1, title: 'B', h1: null, metaDescription: null, wordCount: 20, crawlDepth: 1, indexable: true, issueTypes: ['thin_content'] },
  ],
} as unknown as AggregatedResult

async function clearTestState() {
  await prisma.crawlRun.deleteMany({
    where: { OR: [{ sessionId: SESSION_ID }, { domain: 'par.test' }] },
  })
  await prisma.session.deleteMany({ where: { id: SESSION_ID } })
}

describe('compareSeoParity', () => {
  beforeEach(async () => {
    await clearTestState()
    await prisma.session.create({
      data: { id: SESSION_ID, status: 'complete', files: '[]', result: JSON.stringify(RESULT) },
    })
  })
  afterEach(clearTestState)

  it('reports ok when tables match the blob', async () => {
    await writeSeoFindings(SESSION_ID, RESULT, null)
    const report = await compareSeoParity(SESSION_ID)
    expect(report.diffs).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('reports a diff when a finding is missing from the tables', async () => {
    await writeSeoFindings(SESSION_ID, RESULT, null)
    const run = await prisma.crawlRun.findUniqueOrThrow({ where: { sessionId: SESSION_ID } })
    await prisma.finding.deleteMany({ where: { runId: run.id, type: 'thin_content' } })
    const report = await compareSeoParity(SESSION_ID)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/thin_content/)
  })

  it('reports a diff when a stored finding has the right key but wrong fields', async () => {
    await writeSeoFindings(SESSION_ID, RESULT, null)
    const run = await prisma.crawlRun.findUniqueOrThrow({ where: { sessionId: SESSION_ID } })
    await prisma.finding.updateMany({
      where: { runId: run.id, type: 'broken_pages', scope: 'run' },
      data: { count: 999, severity: 'notice' },
    })
    const report = await compareSeoParity(SESSION_ID)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/count/)
    expect(report.diffs.join('\n')).toMatch(/severity/)
  })

  it('reports a diff when no run exists at all', async () => {
    const report = await compareSeoParity(SESSION_ID)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/no CrawlRun/i)
  })
})
