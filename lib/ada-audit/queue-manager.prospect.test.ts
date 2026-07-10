// lib/ada-audit/queue-manager.prospect.test.ts
// DB-backed: real local SQLite. enqueueAudit creates the row; it may also
// fire-and-forget the promoter, so discover Jobs can appear AFTER row
// creation — afterAll cleans them by dedupKey once all ids are known.
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { enqueueAudit } from './queue-manager'

const DOMAIN = 'c14-enq-prospect.test'
const created: string[] = []

afterAll(async () => {
  await prisma.job.deleteMany({ where: { dedupKey: { in: created.map((id) => `discover:${id}`) } } })
  await prisma.siteAudit.deleteMany({ where: { id: { in: created } } })
  await prisma.prospect.deleteMany({ where: { domain: DOMAIN } })
})

describe('enqueueAudit prospectId threading', () => {
  it('persists prospectId on the created SiteAudit', async () => {
    const prospect = await prisma.prospect.create({ data: { name: 'Acme College', domain: DOMAIN } })
    const { id } = await enqueueAudit(DOMAIN, null, 'wcag21aa', {
      preDiscoveredUrls: [`https://${DOMAIN}/`],
      prospectId: prospect.id,
    })
    created.push(id)
    const row = await prisma.siteAudit.findUnique({ where: { id }, select: { prospectId: true, clientId: true } })
    expect(row?.prospectId).toBe(prospect.id)
    expect(row?.clientId).toBeNull()
  })

  it('defaults prospectId to null when omitted', async () => {
    const { id } = await enqueueAudit(DOMAIN, null, 'wcag21aa', { preDiscoveredUrls: [`https://${DOMAIN}/`] })
    created.push(id)
    const row = await prisma.siteAudit.findUnique({ where: { id }, select: { prospectId: true } })
    expect(row?.prospectId).toBeNull()
  })
})
