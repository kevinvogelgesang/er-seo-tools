import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { runNotifyEmailJob } from './notify-email'

const deps = { fetch: vi.fn(), now: () => 0 }
// vi.mock is hoisted above imports — the spy must be created with vi.hoisted so
// the factory can reference it safely.
const { sendSpy } = vi.hoisted(() => ({ sendSpy: vi.fn(async () => {}) }))
vi.mock('@/lib/notify/transport', async (orig) => {
  const mod = await orig<typeof import('@/lib/notify/transport')>()
  return { ...mod, sendEmail: (...a: unknown[]) => sendSpy(...a) }
})

async function mkAudit(data: Record<string, unknown>): Promise<string> {
  const a = await prisma.siteAudit.create({
    data: { domain: 'notify-test.example', status: 'complete', wcagLevel: 'wcag21aa', ...data },
  })
  return a.id
}

describe('runNotifyEmailJob', () => {
  const OLD = process.env
  beforeEach(() => { sendSpy.mockClear(); process.env = { ...OLD, MAILGUN_API_KEY: 'k', MAILGUN_DOMAIN: 'mg.x', NEXT_PUBLIC_APP_URL: 'https://app.example' } })
  afterEach(async () => {
    process.env = OLD
    // CrawlRun.siteAuditId is onDelete: SetNull — delete runs first so orphans
    // can't contaminate the deterministic previous-run selection of later tests.
    await prisma.crawlRun.deleteMany({ where: { domain: 'notify-test.example' } })
    await prisma.siteAudit.deleteMany({ where: { domain: 'notify-test.example' } })
  })

  it('sends the complete email and stamps notifyCompleteSentAt', async () => {
    const id = await mkAudit({ notifyEmail: 'r@example.com' })
    await runNotifyEmailJob({ siteAuditId: id, kind: 'complete' }, deps)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const row = await prisma.siteAudit.findUnique({ where: { id } })
    expect(row?.notifyCompleteSentAt).not.toBeNull()
  })

  it('no-ops when notifyEmail is null (complete)', async () => {
    const id = await mkAudit({ notifyEmail: null })
    await runNotifyEmailJob({ siteAuditId: id, kind: 'complete' }, deps)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('no-ops when the sent-marker is already set (recovery replay)', async () => {
    const id = await mkAudit({ notifyEmail: 'r@example.com', notifyCompleteSentAt: new Date() })
    await runNotifyEmailJob({ siteAuditId: id, kind: 'complete' }, deps)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('no-ops when the audit row was deleted', async () => {
    await runNotifyEmailJob({ siteAuditId: 'does-not-exist', kind: 'complete' }, deps)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('no-ops (dark) when Mailgun env is unset', async () => {
    const id = await mkAudit({ notifyEmail: 'r@example.com' })
    delete process.env.MAILGUN_API_KEY
    await runNotifyEmailJob({ siteAuditId: id, kind: 'complete' }, deps)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('failed kind routes to the admin address and stamps notifyFailedSentAt', async () => {
    process.env.NOTIFY_ADMIN_EMAIL = 'admin@example.com'
    const id = await mkAudit({ notifyEmail: 'r@example.com', status: 'error', error: 'boom' })
    await runNotifyEmailJob({ siteAuditId: id, kind: 'failed' }, deps)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const arg = sendSpy.mock.calls[0][0] as { to: string }
    expect(arg.to).toBe('admin@example.com')
    const row = await prisma.siteAudit.findUnique({ where: { id } })
    expect(row?.notifyFailedSentAt).not.toBeNull()
  })

  it('no-ops the failed kind when notifyFailedSentAt is already set (recovery replay)', async () => {
    const id = await mkAudit({ notifyEmail: 'r@example.com', status: 'error', error: 'boom', notifyFailedSentAt: new Date() })
    await runNotifyEmailJob({ siteAuditId: id, kind: 'failed' }, deps)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('re-sends after a send failure (marker not stamped)', async () => {
    const id = await mkAudit({ notifyEmail: 'r@example.com' })
    sendSpy.mockRejectedValueOnce(new Error('transient'))
    await expect(runNotifyEmailJob({ siteAuditId: id, kind: 'complete' }, deps)).rejects.toThrow()
    let row = await prisma.siteAudit.findUnique({ where: { id } })
    expect(row?.notifyCompleteSentAt).toBeNull()
    await runNotifyEmailJob({ siteAuditId: id, kind: 'complete' }, deps)
    expect(sendSpy).toHaveBeenCalledTimes(2)
    row = await prisma.siteAudit.findUnique({ where: { id } })
    expect(row?.notifyCompleteSentAt).not.toBeNull()
  })

  it('passes enrichment (counts + pages) to the complete email', async () => {
    const audit = await prisma.siteAudit.create({ data: { domain: 'notify-test.example', status: 'complete', wcagLevel: 'wcag21aa', notifyEmail: 'r@example.com', pagesComplete: 4, pagesTotal: 4 } })
    await prisma.crawlRun.create({ data: { tool: 'seo-parser', source: 'live-scan', status: 'complete', domain: 'notify-test.example', siteAuditId: audit.id, score: 88,
      findings: { create: [{ scope: 'run', type: 'broken_internal_links', severity: 'critical', count: 2, dedupKey: 'z1' }] } } })
    await runNotifyEmailJob({ siteAuditId: audit.id, kind: 'complete' }, deps)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const content = (sendSpy.mock.calls[0][0] as { content: { text: string } }).content
    expect(content.text).toContain('4 of 4')
    expect(content.text).toContain('Broken links & images: 2')
  })

  it('still sends a basic email (and stamps marker once) when enrichment throws', async () => {
    const id = await mkAudit({ notifyEmail: 'r@example.com' })
    const spy = vi.spyOn(prisma.finding, 'aggregate').mockRejectedValueOnce(new Error('db boom'))
    await prisma.crawlRun.create({ data: { tool: 'seo-parser', source: 'live-scan', status: 'complete', domain: 'notify-test.example', siteAuditId: id, score: 50 } })
    await runNotifyEmailJob({ siteAuditId: id, kind: 'complete' }, deps)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const row = await prisma.siteAudit.findUnique({ where: { id } })
    expect(row?.notifyCompleteSentAt).not.toBeNull()
    spy.mockRestore()
  })
})
