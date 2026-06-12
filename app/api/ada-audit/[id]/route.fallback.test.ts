// app/api/ada-audit/[id]/route.fallback.test.ts
//
// DB-backed tests for the C3 archived-blob fallback on GET /api/ada-audit/[id].
// The sibling route.test.ts is mock-based (DELETE-focused) — these seed real
// rows (domain prefix c3det-*.example) and call the handler directly.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { writeAdaSingleFindings } from '@/lib/findings/ada-write'
import { GET } from './route'

const DOMAIN = 'c3det-page.example'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function axeBlob(url: string): string {
  return JSON.stringify({
    violations: [
      {
        id: 'color-contrast',
        impact: 'serious',
        help: 'Elements must have sufficient color contrast',
        description: 'Full description — lost on archive by contract',
        helpUrl: 'https://example.org/cc',
        tags: ['wcag2aa'],
        nodes: [{ html: '<a class="cta">x</a>', target: ['footer > a.cta'] }],
      },
    ],
    passes: [{ id: 'p1', help: 'p', nodes: [] }],
    incomplete: [],
    inapplicable: [],
    timestamp: '2026-06-12T00:00:00Z',
    url,
    testEngine: { name: 'axe-core', version: '4.10' },
    testRunner: { name: 'er-seo-tools' },
  })
}

async function clearState() {
  // CrawlRun first (subtree cascades from it), THEN the origin rows.
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: 'c3det-' } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: 'c3det-' } } })
}

describe('GET /api/ada-audit/[id] — archived fallback', () => {
  beforeEach(clearState)
  afterEach(clearState)

  it('synthesizes archived results from Violation rows when the blob is pruned', async () => {
    const url = `https://${DOMAIN}/pruned`
    const audit = await prisma.adaAudit.create({
      data: {
        url,
        status: 'complete',
        wcagLevel: 'wcag21aa',
        result: axeBlob(url),
        startedAt: new Date(),
        completedAt: new Date(),
      },
    })
    await writeAdaSingleFindings(audit.id)
    await prisma.adaAudit.update({ where: { id: audit.id }, data: { result: null } })

    const res = await GET({} as never, makeParams(audit.id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('complete')
    expect(body.results).not.toBeNull()
    expect(body.results.archived).toBe(true)
    expect(body.results.archivedCounts).toEqual({ passed: 1, incomplete: 0 })
    expect(body.results.violations).toHaveLength(1)
    expect(body.results.violations[0].id).toBe('color-contrast')
    expect(body.results.violations[0].impact).toBe('serious')
  })

  it('returns null results when the blob is gone and no findings exist (pre-A2 — legacy copy path)', async () => {
    const audit = await prisma.adaAudit.create({
      data: {
        url: `https://${DOMAIN}/pre-a2`,
        status: 'complete',
        wcagLevel: 'wcag21aa',
        result: null,
      },
    })

    const res = await GET({} as never, makeParams(audit.id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('complete')
    expect(body.results).toBeNull()
  })

  it('still prefers the stored blob when present (no archived marker)', async () => {
    const url = `https://${DOMAIN}/live`
    const audit = await prisma.adaAudit.create({
      data: {
        url,
        status: 'complete',
        wcagLevel: 'wcag21aa',
        result: axeBlob(url),
      },
    })

    const res = await GET({} as never, makeParams(audit.id))
    const body = await res.json()
    expect(body.results.archived).toBeUndefined()
    expect(body.results.passes).toHaveLength(1)
  })
})
