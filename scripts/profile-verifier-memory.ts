// scripts/profile-verifier-memory.ts
// Dev-only: seeds a synthetic worst-case audit and profiles runBrokenLinkVerify
// stage-by-stage (rss/heap/elapsed via reportProgress checkpoints + a sampler).
// NEVER deployed / imported by app code. Usage:
//   DATABASE_URL="file:./local-dev.db" npx tsx scripts/profile-verifier-memory.ts [--pages 1000] [--links-per-page 300] [--text-kb 30]
import { prisma } from '../lib/db'
import { runBrokenLinkVerify, type VerifyDeps } from '../lib/jobs/handlers/broken-link-verify'

const args = new Map(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : []).filter((p) => p.length) as [string, string][])
const PAGES = Number(args.get('pages') ?? 1000)
const LINKS = Number(args.get('links-per-page') ?? 300)
const TEXT_KB = Number(args.get('text-kb') ?? 30)
const DOMAIN = 'profile-verifier.example.com'

function mb(n: number): number { return Math.round(n / 1048576) }
const marks: { stage: string; rssMB: number; heapMB: number; at: number }[] = []
let peakRss = 0
function mark(stage: string): void {
  const m = process.memoryUsage()
  peakRss = Math.max(peakRss, m.rss)
  marks.push({ stage, rssMB: mb(m.rss), heapMB: mb(m.heapUsed), at: Date.now() })
}

async function seed(): Promise<string> {
  await cleanup()
  const urls = Array.from({ length: PAGES }, (_, i) => `https://${DOMAIN}/page-${String(i).padStart(4, '0')}`)
  const sa = await prisma.siteAudit.create({ data: {
    domain: DOMAIN, status: 'complete', pagesTotal: PAGES, pagesComplete: PAGES,
    discoveredUrls: JSON.stringify(urls), discoveryMode: 'sitemap',
  } })
  const text = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do '.repeat(Math.ceil((TEXT_KB * 1024) / 62)).slice(0, TEXT_KB * 1024)
  for (let i = 0; i < PAGES; i += 50) {
    await prisma.harvestedPageSeo.createMany({ data: urls.slice(i, i + 50).map((url, j) => ({
      siteAuditId: sa.id, url, statusCode: 200, isHtml: true, robotsNoindex: false, xRobotsNoindex: false,
      loginLike: false, title: `Title ${i + j}`, h1: `H1 ${i + j}`, metaDescription: `Meta ${i + j}`,
      wordCount: 5000, schemaCount: 1, canonicalUrl: url, detailsJson: null,
      contentText: `${text} page-variant-${i + j}`, contentTruncated: false,
    })) })
  }
  // Chunk createMany calls into array-form $transaction batches of ~20
  // statements at a time (house rule: array-form $transaction only, never
  // the interactive callback form) — seeding 300k rows one createMany(50) at
  // a time is otherwise painfully slow.
  const BATCH_STATEMENTS = 20
  let pending: ReturnType<typeof prisma.harvestedLink.createMany>[] = []
  const flush = async (): Promise<void> => {
    if (!pending.length) return
    await prisma.$transaction(pending)
    pending = []
  }
  for (let i = 0; i < PAGES; i++) {
    const links = Array.from({ length: LINKS }, (_, k) => ({
      siteAuditId: sa.id, sourcePageUrl: urls[i],
      targetUrl: urls[(i * 7 + k) % PAGES], kind: 'internal-link', harvestTruncated: false,
    }))
    for (let c = 0; c < links.length; c += 50) {
      pending.push(prisma.harvestedLink.createMany({ data: links.slice(c, c + 50) }))
      if (pending.length >= BATCH_STATEMENTS) await flush()
    }
  }
  await flush()
  return sa.id
}

async function cleanup(): Promise<void> {
  const sas = await prisma.siteAudit.findMany({ where: { domain: DOMAIN }, select: { id: true } })
  const ids = sas.map((s) => s.id)
  if (!ids.length) return
  await prisma.harvestedLink.deleteMany({ where: { siteAuditId: { in: ids } } })
  await prisma.harvestedPageSeo.deleteMany({ where: { siteAuditId: { in: ids } } })
  await prisma.crawlRun.deleteMany({ where: { siteAuditId: { in: ids } } })
  await prisma.siteAudit.deleteMany({ where: { id: { in: ids } } })
}

async function main(): Promise<void> {
  console.log(`[profile] seeding ${PAGES} pages x ${LINKS} links, ${TEXT_KB}KB text`)
  const id = await seed()
  const plan = await prisma.$queryRawUnsafe<unknown[]>(
    `EXPLAIN QUERY PLAN SELECT * FROM "HarvestedLink" WHERE "siteAuditId" = ? AND "kind" IN ('internal-link','image') ORDER BY "targetUrl" ASC, "kind" ASC, "sourcePageUrl" ASC, "id" ASC LIMIT 5000`, id)
  // EXPLAIN QUERY PLAN rows come back with BigInt columns (e.g. selectid/order/from)
  // under Prisma's raw-query driver — JSON.stringify throws on BigInt without a
  // replacer.
  console.log('[profile] EXPLAIN QUERY PLAN:', JSON.stringify(plan, (_k, v) => typeof v === 'bigint' ? Number(v) : v))
  const deps: VerifyDeps = {
    resolve: async () => ({ result: 'ok', finalUrl: null, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
    resolveExternal: async () => ({ result: 'ok', finalUrl: null, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
    now: () => Date.now(), sleep: () => Promise.resolve(),
  }
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss) }, 100)
  mark('start')
  await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps, {
    reportProgress: (_p: number | null, msg: string | null) => { if (msg) mark(msg) },
  } as never)
  mark('end')
  clearInterval(sampler)
  const t0 = marks[0].at
  console.table(marks.map((m) => ({ stage: m.stage.slice(0, 48), rssMB: m.rssMB, heapMB: m.heapMB, elapsedMs: m.at - t0 })))
  console.log(`[profile] peak rss ${mb(peakRss)}MB (baseline ${marks[0].rssMB}MB, marginal ${mb(peakRss) - marks[0].rssMB}MB)`)
  await cleanup()
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
