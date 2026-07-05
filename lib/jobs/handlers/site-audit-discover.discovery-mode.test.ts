// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'

// Mock discoverPages so the handler runs without network.
vi.mock('@/lib/ada-audit/sitemap-crawler', () => ({
  discoverPages: vi.fn(async () => ({
    urls: ['https://example.com/a', 'https://example.com/b'],
    mode: 'sitemap' as const,
    capped: false,
  })),
}))

import { runSiteAuditDiscoverJob } from './site-audit-discover'

describe('site-audit-discover records discovery provenance', () => {
  let siteAuditId: string
  beforeEach(async () => {
    const audit = await prisma.siteAudit.create({
      data: { domain: 'example.com', status: 'running', wcagLevel: 'wcag21aa' },
    })
    siteAuditId = audit.id
  })

  it('persists discoveryMode=sitemap and discoveryCapped=false from discoverPages', async () => {
    await runSiteAuditDiscoverJob({ siteAuditId } as any)
    const audit = await prisma.siteAudit.findUnique({
      where: { id: siteAuditId },
      select: { discoveryMode: true, discoveryCapped: true, pagesTotal: true },
    })
    expect(audit?.discoveryMode).toBe('sitemap')
    expect(audit?.discoveryCapped).toBe(false)
    expect(audit?.pagesTotal).toBe(2)
  })
})
