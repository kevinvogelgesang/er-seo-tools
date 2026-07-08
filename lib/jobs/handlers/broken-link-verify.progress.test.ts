import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { runBrokenLinkVerify, type VerifyDeps } from './broken-link-verify'

const DOMAIN = 'c6blv-progress.example.com'

async function clean() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.harvestedLink.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}
beforeEach(clean)
afterEach(async () => { await prisma.scoringWeights.deleteMany({ where: { id: 1 } }) })
afterAll(clean)

async function seed(targets: { targetUrl: string; kind: string; sourcePageUrl: string }[]) {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: null } })
  if (targets.length)
    await prisma.harvestedLink.createMany({ data: targets.map((t) => ({ ...t, siteAuditId: sa.id })) })
  return sa.id
}

describe('runBrokenLinkVerify — progress reporting', () => {
  it('reports "Checked X/Y links" progress during resolution', async () => {
    const reportProgress = vi.fn()
    const ctx = { jobId: 'j1', attempt: 1, signal: new AbortController().signal, reportProgress }
    const stubDeps: VerifyDeps = {
      resolve: async () => ({ result: 'ok', finalUrl: null, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
      resolveExternal: async () => ({ result: 'ok', finalUrl: null, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
      now: () => 0,
      sleep: async () => {},
    }
    const id = await seed([
      { targetUrl: 'https://c6blv-progress.example.com/a', kind: 'internal-link', sourcePageUrl: 'https://c6blv-progress.example.com/x' },
      { targetUrl: 'https://c6blv-progress.example.com/b', kind: 'internal-link', sourcePageUrl: 'https://c6blv-progress.example.com/x' },
    ])
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, stubDeps, ctx)
    expect(reportProgress).toHaveBeenCalled()
    const msgs = reportProgress.mock.calls.map((c) => c[1]).filter(Boolean) as string[]
    expect(msgs.some((m) => /Checked \d+\/\d+ links/.test(m))).toBe(true)
    // finalize phase reports the building message:
    expect(reportProgress.mock.calls.some((c) => c[1] === 'Building SEO report…')).toBe(true)
  })
})
