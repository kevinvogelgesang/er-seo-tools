// lib/sales/representative-examples.test.ts
// DB-backed: seeds a SiteAudit + child AdaAudit with a result blob.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { loadRepresentativeExamples } from './representative-examples'
import type { CommonIssue } from '@/lib/ada-audit/types'

const PREFIX = 'c14-rep-'
const created = { site: [] as string[], child: [] as string[] }
async function cleanup() {
  await prisma.adaAudit.deleteMany({ where: { id: { in: created.child } } })
  await prisma.siteAudit.deleteMany({ where: { id: { in: created.site } } })
}
beforeAll(cleanup)
afterAll(cleanup)

const issue = (over: Partial<CommonIssue> = {}): CommonIssue => ({
  ruleId: 'color-contrast', impact: 'serious', help: 'Elements must have sufficient color contrast',
  description: 'desc', helpUrl: 'https://x', affectedPagesCount: 3, totalPagesScanned: 5,
  sharedAncestor: null, ancestorConfidence: null, examplePageUrl: `https://${PREFIX}x.test/a`,
  ...over,
})

function resultBlob() {
  return JSON.stringify({
    violations: [{
      id: 'color-contrast', impact: 'serious', help: 'h', description: 'd', helpUrl: 'u', tags: [],
      nodes: [
        { html: '<a class="cta">Apply</a>', target: ['a.cta'], screenshotPath: 'color-contrast-0.png' },
        { html: '<a class="cta">Apply</a>', target: ['a.cta'] }, // duplicate html → deduped
        { html: '<p class="fine">x</p>', target: ['p.fine'] },
      ],
    }],
    passes: [], incomplete: [], inapplicable: [],
    timestamp: 't', url: `https://${PREFIX}x.test/a`,
    testEngine: { name: 'axe', version: '4' }, testRunner: { name: 'axe' },
  })
}

describe('loadRepresentativeExamples', () => {
  it('extracts deduped nodes for the rule from the example page child audit', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}x.test`, wcagLevel: 'wcag21aa', status: 'complete' },
    })
    created.site.push(site.id)
    const child = await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}x.test/a`, status: 'complete', siteAuditId: site.id, result: resultBlob() },
    })
    created.child.push(child.id)

    const out = await loadRepresentativeExamples(site.id, issue(), 5)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      html: '<a class="cta">Apply</a>', selector: 'a.cta',
      screenshotFile: 'color-contrast-0.png', adaAuditId: child.id,
      pageUrl: `https://${PREFIX}x.test/a`,
    })
    expect(out[1].screenshotFile).toBeNull()
  })

  it('returns [] when no example page or child audit matches', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}none.test`, wcagLevel: 'wcag21aa', status: 'complete' },
    })
    created.site.push(site.id)
    expect(await loadRepresentativeExamples(site.id, issue({ examplePageUrl: null }))).toEqual([])
    expect(await loadRepresentativeExamples(site.id, issue({ examplePageUrl: 'https://nope.test/x' }))).toEqual([])
  })
})
