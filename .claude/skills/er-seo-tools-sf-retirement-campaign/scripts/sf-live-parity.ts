// .claude/skills/er-seo-tools-sf-retirement-campaign/scripts/sf-live-parity.ts
//
// SF-vs-Live parity report for one domain (SF-retirement campaign, Phase 1).
// Read-only. Compares the latest sf-upload CrawlRun and the latest
// seoIntent=true live-scan CrawlRun for the same domain:
//   1. score delta
//   2. page-set overlap (normalized CrawlPage.url sets)
//   3. per-issue-type run-scope Finding count deltas (with the known
//      SF-vs-live type-name aliases mapped)
//
// Usage (local): DATABASE_URL="file:./local-dev.db" npx tsx .claude/skills/er-seo-tools-sf-retirement-campaign/scripts/sf-live-parity.ts <domain>
// Usage (prod):  cd /home/seo/webapps/seo-tools && npx tsx <this file> <domain>
//
// Run from the repo root (matches the DATABASE_URL="file:./local-dev.db" convention;
// imports themselves are file-relative and resolve from any cwd).

import { prisma } from '../../../../lib/db'
import { normalizeFindingUrl } from '../../../../lib/findings/normalize-url'
import { normaliseSiteAuditDomain } from '../../../../lib/ada-audit/site-audit-helpers'

// Known name divergences between the SF aggregator's issue types and the
// live on-page mapper's types. Everything else compares by identical name.
// (SF side verified in lib/services/aggregator.service.ts; live side in
// lib/findings/onpage-seo-mapper.ts + broken-link-mapper.ts.)
const SF_TO_LIVE_ALIAS: Record<string, string> = {
  duplicate_titles: 'duplicate_title',
}

async function loadRun(where: object) {
  return prisma.crawlRun.findFirst({
    where,
    orderBy: { completedAt: 'desc' },
    select: { id: true, source: true, score: true, completedAt: true, seoIntent: true },
  })
}

async function runScopeCounts(runId: string): Promise<Map<string, number>> {
  const rows = await prisma.finding.findMany({
    where: { runId, scope: 'run' },
    select: { type: true, count: true },
  })
  return new Map(rows.map((r) => [r.type, r.count]))
}

async function pageUrls(runId: string): Promise<Set<string>> {
  const rows = await prisma.crawlPage.findMany({ where: { runId }, select: { url: true } })
  return new Set(rows.map((r) => normalizeFindingUrl(r.url)))
}

async function main() {
  const rawDomain = process.argv[2]
  if (!rawDomain) {
    console.error('Usage: npx tsx sf-live-parity.ts <domain>')
    process.exit(1)
  }
  const domain = normaliseSiteAuditDomain(rawDomain)

  const sf = await loadRun({ tool: 'seo-parser', source: 'sf-upload', domain })
  const live = await loadRun({ tool: 'seo-parser', source: 'live-scan', seoIntent: true, domain })

  if (!sf || !live) {
    console.log(`domain=${domain}`)
    console.log(`  sf-upload run:      ${sf ? sf.id : 'NONE'}`)
    console.log(`  seoIntent live run: ${live ? live.id : 'NONE'}`)
    console.log('Need BOTH runs to compare. Upload an SF crawl and/or trigger a seoIntent audit first.')
    process.exit(2)
  }

  console.log(`domain=${domain}`)
  console.log(`  SF   run ${sf.id}  completed ${sf.completedAt?.toISOString() ?? 'n/a'}  score ${sf.score ?? 'null'}`)
  console.log(`  Live run ${live.id}  completed ${live.completedAt?.toISOString() ?? 'n/a'}  score ${live.score ?? 'null'}`)
  if (sf.score != null && live.score != null) {
    console.log(`  score delta (live - SF): ${live.score - sf.score}`)
  } else {
    console.log('  score delta: not computable (a score is null)')
  }

  // Page-set overlap
  const [sfPages, livePages] = await Promise.all([pageUrls(sf.id), pageUrls(live.id)])
  const inter = [...sfPages].filter((u) => livePages.has(u)).length
  const union = new Set([...sfPages, ...livePages]).size
  console.log(`\nPage sets: SF=${sfPages.size}  Live=${livePages.size}  overlap=${inter}  jaccard=${union ? (inter / union).toFixed(3) : 'n/a'}`)
  const sfOnly = [...sfPages].filter((u) => !livePages.has(u))
  const liveOnly = [...livePages].filter((u) => !sfPages.has(u))
  console.log(`  SF-only pages: ${sfOnly.length}${sfOnly.length ? ' (first 10 below)' : ''}`)
  sfOnly.slice(0, 10).forEach((u) => console.log(`    ${u}`))
  console.log(`  Live-only pages: ${liveOnly.length}${liveOnly.length ? ' (first 10 below)' : ''}`)
  liveOnly.slice(0, 10).forEach((u) => console.log(`    ${u}`))

  // Per-type run-scope count deltas
  const [sfCounts, liveCounts] = await Promise.all([runScopeCounts(sf.id), runScopeCounts(live.id)])
  const mappedSf = new Map<string, number>()
  for (const [type, count] of sfCounts) mappedSf.set(SF_TO_LIVE_ALIAS[type] ?? type, count)
  const allTypes = [...new Set([...mappedSf.keys(), ...liveCounts.keys()])].sort()
  console.log('\nRun-scope finding counts (SF | Live | delta):')
  for (const t of allTypes) {
    const s = mappedSf.get(t)
    const l = liveCounts.get(t)
    const delta = s != null && l != null ? String(l - s) : 'n/a'
    console.log(`  ${t.padEnd(32)} ${String(s ?? '—').padStart(6)} | ${String(l ?? '—').padStart(6)} | ${delta}`)
  }
  console.log('\nNote: live covers on-page types + broken_internal_links/broken_images only.')
  console.log('SF-only types (redirects, alt text, duplicates-by-content, etc.) showing "—" on the')
  console.log('Live side are EXPECTED gaps, not regressions — record them, do not chase them.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
