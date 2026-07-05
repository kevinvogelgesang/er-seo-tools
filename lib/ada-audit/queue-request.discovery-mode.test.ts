// @vitest-environment node
//
// Sibling to queue-request.test.ts, deliberately NOT mocking queue-manager —
// queue-request.test.ts mocks enqueueAudit for its own assertions, which
// means it never exercises the real SiteAudit.create() write path. This
// file verifies the real end-to-end persisted value: a client with
// seedUrls routes through enqueueAudit({ preDiscoveredUrls }), which sets
// discoveryMode: 'pre-discovered' (Task 3 provenance).
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { queueSiteAuditRequest } from './queue-request'

describe('queueSiteAuditRequest discovery provenance (real enqueueAudit)', () => {
  beforeEach(async () => {
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'qr-dm-test-' } } })
    await prisma.client.deleteMany({ where: { name: { startsWith: 'qr-dm-test-client-' } } })
  })

  it('a client with seedUrls yields discoveryMode=pre-discovered', async () => {
    const client = await prisma.client.create({
      data: {
        name: 'qr-dm-test-client-seed',
        seedUrls: JSON.stringify([
          'https://qr-dm-test-seed.example/x',
          'https://qr-dm-test-seed.example/y',
        ]),
      },
    })

    const res = await queueSiteAuditRequest({
      domain: 'qr-dm-test-seed.example',
      clientId: client.id,
      wcagLevel: 'wcag21aa',
    })

    expect(res.kind).toBe('queued')
    if (res.kind !== 'queued') throw new Error(`expected queued, got ${JSON.stringify(res)}`)

    const audit = await prisma.siteAudit.findUnique({
      where: { id: res.id },
      select: { discoveryMode: true, discoveryCapped: true },
    })
    expect(audit?.discoveryMode).toBe('pre-discovered')
    expect(audit?.discoveryCapped).toBeNull()

    await prisma.client.delete({ where: { id: client.id } })
  })
})
