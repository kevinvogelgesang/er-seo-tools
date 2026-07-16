// app/ada-audit/site/[id]/page.seo-only-redirect.test.tsx
//
// Verifier-memory-loop fix (Task 4): the page's early seoOnly branch derives
// its own liveScanRunId (independent of GET /api/site-audit/[id]) to decide
// whether to redirect straight to the SEO run results page. An exhausted
// verifier's terminal placeholder run (source: 'live-scan-placeholder') must
// NOT be treated as a real run here — redirecting to its run page would land
// on a page with no real SEO content. A real live-scan run must still redirect
// (regression guard for the existing C16 behavior).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@/lib/db'

// vi.mock is hoisted above imports by vitest's transform — the spy must be
// created with vi.hoisted so the factory can reference it safely.
const { redirectSpy } = vi.hoisted(() => ({
  redirectSpy: vi.fn((href: string) => {
    throw new Error(`REDIRECT:${href}`)
  }),
}))
vi.mock('next/navigation', async (orig) => {
  const mod = await orig<typeof import('next/navigation')>()
  return { ...mod, redirect: (href: string) => redirectSpy(href) }
})

import SiteAuditResultPage from './page'

const DOMAIN = 'c21ph-seoonly-redirect.example'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

async function clearState() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}

describe('SiteAuditResultPage — seoOnly early-branch redirect derivation', () => {
  beforeEach(async () => {
    redirectSpy.mockClear()
    await clearState()
  })
  afterEach(clearState)

  it('redirects to the SEO run results page for a real live-scan run', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', wcagLevel: 'wcag21aa', seoOnly: true },
    })
    const run = await prisma.crawlRun.create({
      data: { siteAuditId: site.id, tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete' },
    })

    await expect(SiteAuditResultPage(makeParams(site.id))).rejects.toThrow(`REDIRECT:/seo-audits/results/run/${run.id}`)
    expect(redirectSpy).toHaveBeenCalledWith(`/seo-audits/results/run/${run.id}`)
  })

  it('does NOT redirect to an exhausted-verifier placeholder run — banner stays up', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', wcagLevel: 'wcag21aa', seoOnly: true },
    })
    await prisma.crawlRun.create({
      data: { siteAuditId: site.id, tool: 'seo-parser', source: 'live-scan-placeholder', domain: DOMAIN, status: 'partial', seoIntent: false },
    })

    await SiteAuditResultPage(makeParams(site.id))
    expect(redirectSpy).not.toHaveBeenCalled()
  })
})
