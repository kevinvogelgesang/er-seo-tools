import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'
import { randomUUID } from 'crypto'

describe('CrawlRun.contentSimilarityJson column', () => {
  it('persists and reads back the JSON, and defaults to null', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: 'colcheck.test', status: 'complete' } })
    const withJson = await prisma.crawlRun.create({
      data: { id: randomUUID(), tool: 'seo-parser', source: 'live-scan', status: 'complete', siteAuditId: sa.id, contentSimilarityJson: '{"v":1}' },
    })
    expect(withJson.contentSimilarityJson).toBe('{"v":1}')
    // default null when omitted (separate SiteAudit — one live-scan run per audit via the C6 compound unique)
    const sa2 = await prisma.siteAudit.create({ data: { domain: 'colcheck.test', status: 'complete' } })
    const noJson = await prisma.crawlRun.create({ data: { id: randomUUID(), tool: 'ada-audit', source: 'ada-audit', status: 'complete', siteAuditId: sa2.id } })
    expect(noJson.contentSimilarityJson).toBeNull()
    await prisma.siteAudit.deleteMany({ where: { domain: 'colcheck.test' } })
  })
})
