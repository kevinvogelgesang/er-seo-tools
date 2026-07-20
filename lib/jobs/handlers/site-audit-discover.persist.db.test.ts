// lib/jobs/handlers/site-audit-discover.persist.db.test.ts
//
// DB-backed: proves the first-writer-wins persist contract (spec F5 / Codex fix
// 6) — two concurrent attempts with different rendered results yield exactly one
// coherent (discoveredUrls, sources) tuple; the loser's write no-ops.
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'

describe('site-audit-discover persist race (spec F5)', () => {
  it('two attempts with different rendered results → exactly one coherent (discoveredUrls, sources) tuple wins', async () => {
    const audit = await prisma.siteAudit.create({
      data: { domain: 'race.example', wcagLevel: 'wcag21aa', status: 'running', seoIntent: true, discoveredUrls: null },
    })
    try {
      const writeA = prisma.siteAudit.updateMany({
        where: { id: audit.id, discoveredUrls: null, status: 'running' },
        data: {
          discoveredUrls: JSON.stringify(['https://race.example/a']), pagesTotal: 1,
          discoverySourcesJson: JSON.stringify({ v: 2, sources: { 'https://race.example/a': 'rendered-linked' } }),
        },
      })
      const writeB = prisma.siteAudit.updateMany({
        where: { id: audit.id, discoveredUrls: null, status: 'running' },
        data: {
          discoveredUrls: JSON.stringify(['https://race.example/b']), pagesTotal: 1,
          discoverySourcesJson: JSON.stringify({ v: 2, sources: { 'https://race.example/b': 'rendered-linked' } }),
        },
      })
      const [rA, rB] = await Promise.all([writeA, writeB])
      expect(rA.count + rB.count).toBe(1) // exactly one write lands (first-writer-wins on discoveredUrls: null)

      const row = await prisma.siteAudit.findUnique({
        where: { id: audit.id }, select: { discoveredUrls: true, discoverySourcesJson: true },
      })
      const urls = JSON.parse(row!.discoveredUrls!) as string[]
      const sources = (JSON.parse(row!.discoverySourcesJson!) as { sources: Record<string, string> }).sources
      expect(Object.keys(sources)).toEqual(urls) // coherent 1:1: surviving urls + sources describe the SAME winner
    } finally {
      await prisma.siteAudit.delete({ where: { id: audit.id } })
    }
  })
})
