// lib/jobs/handlers/broken-link-verify.emit.test.ts
//
// A5 PR2 Task 14: the live-scan builder's post-commit readiness re-emit.
// A seoOnly site audit flips its parent SiteAudit to 'complete' BEFORE this
// job builds the live-scan CrawlRun — the results page only becomes ready
// once THIS write commits. Separate file from broken-link-verify.test.ts
// (which does not mock the bus) so the writer can be failure-injected
// without disturbing the large existing suite.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/events/bus', () => ({ publishInvalidation: vi.fn() }))

// vi.hoisted escape hatch (site-audit-finalizer.findings.test.ts precedent):
// factories are hoisted above module scope, so a plain `let` would be in the
// temporal dead zone when the factory below runs.
const state = vi.hoisted(() => ({ failWrite: false }))
vi.mock('@/lib/findings/writer', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/findings/writer')>()
  return {
    writeFindingsRun: vi.fn(async (bundle: Parameters<typeof real.writeFindingsRun>[0]) => {
      if (state.failWrite) throw new Error('injected findings write failure')
      return real.writeFindingsRun(bundle)
    }),
  }
})

const { prisma } = await import('@/lib/db')
const { runBrokenLinkVerify } = await import('./broken-link-verify')
const { publishInvalidation } = await import('@/lib/events/bus')
const { siteAuditTopic, prospectListTopic, clientSummaryTopic, recentsTopic } = await import('@/lib/events/topics')

const DOMAIN = 'c6blv-emit.example.com'

async function clean() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.harvestedLink.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  await prisma.prospect.deleteMany({ where: { domain: DOMAIN } })
}

const noopDeps = {
  resolve: async () => ({ result: 'ok' as const, finalUrl: null, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
  resolveExternal: async () => ({ result: 'ok' as const, finalUrl: null, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
  now: () => 0,
  sleep: async () => {},
}

describe('runBrokenLinkVerify — post-commit readiness re-emit (Task 14)', () => {
  beforeEach(async () => {
    state.failWrite = false
    vi.mocked(publishInvalidation).mockClear()
    await clean()
  })

  it('emits site-audit, client-audit-summary, and recents after the live-scan run commits (no prospectId)', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: null } })

    await runBrokenLinkVerify({ siteAuditId: sa.id, domain: DOMAIN }, noopDeps)

    const calls = vi.mocked(publishInvalidation).mock.calls.map((c) => c[0])
    expect(calls).toContain(siteAuditTopic(sa.id))
    expect(calls).toContain(clientSummaryTopic())
    expect(calls).toContain(recentsTopic())
    expect(calls).not.toContain(prospectListTopic())
  })

  it('also emits prospect-list when the parent SiteAudit has a prospectId', async () => {
    const prospect = await prisma.prospect.create({ data: { name: 'Acme College', domain: DOMAIN } })
    const sa = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', clientId: null, prospectId: prospect.id },
    })

    await runBrokenLinkVerify({ siteAuditId: sa.id, domain: DOMAIN }, noopDeps)

    const calls = vi.mocked(publishInvalidation).mock.calls.map((c) => c[0])
    expect(calls).toContain(siteAuditTopic(sa.id))
    expect(calls).toContain(prospectListTopic())
    expect(calls).toContain(clientSummaryTopic())
    expect(calls).toContain(recentsTopic())
  })

  it('does not emit anything when writeFindingsRun fails', async () => {
    state.failWrite = true
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: null } })

    await expect(runBrokenLinkVerify({ siteAuditId: sa.id, domain: DOMAIN }, noopDeps)).rejects.toThrow(
      'injected findings write failure',
    )

    expect(publishInvalidation).not.toHaveBeenCalled()
  })
})
