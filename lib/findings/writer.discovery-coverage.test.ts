// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { writeFindingsRun } from './writer'
import type { CrawlRunInput } from './types'

function baseRun(siteAuditId: string): CrawlRunInput {
  return {
    id: randomUUID(), tool: 'seo-parser', source: 'live-scan', domain: 'example.com',
    clientId: null, sessionId: null, siteAuditId, adaAuditId: null, status: 'complete',
    score: null, scoreBreakdown: null, wcagLevel: null, pagesTotal: 0,
    startedAt: null, completedAt: null,
  }
}

describe('writeFindingsRun persists discoveryCoverageJson', () => {
  let siteAuditId: string
  beforeEach(async () => {
    const audit = await prisma.siteAudit.create({
      data: { domain: 'example.com', status: 'complete', wcagLevel: 'wcag21aa' },
    })
    siteAuditId = audit.id
  })

  it('round-trips the discoveryCoverageJson column', async () => {
    const json = JSON.stringify({ missRate: 0.25, offBaselineCount: 3 })
    await writeFindingsRun({
      run: { ...baseRun(siteAuditId), discoveryCoverageJson: json },
      pages: [], findings: [], violations: [],
    })
    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      select: { discoveryCoverageJson: true },
    })
    expect(run?.discoveryCoverageJson).toBe(json)
  })

  it('leaves the column null when the field is omitted', async () => {
    await writeFindingsRun({ run: baseRun(siteAuditId), pages: [], findings: [], violations: [] })
    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      select: { discoveryCoverageJson: true },
    })
    expect(run?.discoveryCoverageJson).toBeNull()
  })
})
