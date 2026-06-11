// lib/findings/seo-write.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import type { AggregatedResult } from '@/lib/types'
import { writeSeoFindings } from './seo-write'

const SESSION_ID = 'test-findings-seo-write'

const RESULT = {
  crawl_summary: { total_urls: 1 },
  issues: {
    critical: [],
    warnings: [{ type: 'missing_h1', severity: 'warning', count: 1, description: 'Missing H1', affectedUrlRefs: [0], affectedUrlRefsComplete: true }],
    notices: [],
  },
  site_structure: {}, resources: {}, technical_seo: {}, performance: {},
  recommendations: [],
  metadata: { files_processed: [], parsers_used: [], total_parsers_available: 41, site_name: 'sw.test', health_score: 91 },
  url_registry: {
    sessionOrigin: { scheme: 'https', host: 'sw.test' },
    hosts: ['sw.test'],
    urls: [{ id: 0, kind: 'page', hostId: 0, scheme: 'https', path: '/x' }],
  },
  page_index: [{ ref: 0, title: 'X', h1: null, metaDescription: null, wordCount: 10, crawlDepth: 1, indexable: true, issueTypes: ['missing_h1'] }],
} as unknown as AggregatedResult

async function clearTestState() {
  await prisma.crawlRun.deleteMany({
    where: { OR: [{ sessionId: SESSION_ID }, { domain: 'sw.test' }] },
  })
  await prisma.session.deleteMany({ where: { id: SESSION_ID } })
}

describe('writeSeoFindings', () => {
  beforeEach(async () => {
    await clearTestState()
    await prisma.session.create({ data: { id: SESSION_ID, status: 'complete', files: '[]' } })
  })
  afterEach(clearTestState)

  it('maps + persists a run for the session', async () => {
    await writeSeoFindings(SESSION_ID, RESULT, null)
    const run = await prisma.crawlRun.findUnique({
      where: { sessionId: SESSION_ID },
      include: { pages: true, findings: true },
    })
    expect(run).not.toBeNull()
    expect(run!.tool).toBe('seo-parser')
    expect(run!.score).toBe(91)
    expect(run!.pages).toHaveLength(1)
    expect(run!.findings).toHaveLength(2) // 1 run-scope + 1 page-scope
    expect(run!.startedAt).not.toBeNull() // pulled from session.createdAt
  })
})
