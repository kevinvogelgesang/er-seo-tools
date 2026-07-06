import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { runBrokenLinkVerify, type VerifyDeps } from './broken-link-verify'

const DOMAIN = 'c6tb.example.com'
const url = (i: number) => `https://c6tb.example.com/p${i}`

async function clean() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.harvestedLink.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}
beforeEach(clean)
afterEach(async () => {
  vi.unstubAllEnvs() // restore env, never leak BROKEN_LINK_* to other tests
  await prisma.scoringWeights.deleteMany({ where: { id: 1 } })
})
afterAll(clean)

// N distinct internal targets (p0..p{n-1}), each linked from one source page on DOMAIN.
async function seedInternal(n: number) {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: null } })
  const data = Array.from({ length: n }, (_, i) => ({
    siteAuditId: sa.id, targetUrl: url(i), kind: 'internal-link', sourcePageUrl: 'https://c6tb.example.com/a',
  }))
  if (n) await prisma.harvestedLink.createMany({ data })
  return sa.id
}

// Deterministic clock: now() reads a shared `clock`; resolve() advances it by
// stepMs and counts calls. brokenSet -> those targets resolve 'broken' (lets us
// assert only-resolved-are-counted). throwSet -> resolve() throws (exercises the
// failure isolation).
function makeDeps(opts: { stepMs?: number; brokenSet?: Set<string>; throwSet?: Set<string> } = {}) {
  const { stepMs = 0, brokenSet = new Set<string>(), throwSet = new Set<string>() } = opts
  let clock = 0
  let calls = 0
  const deps: VerifyDeps = {
    resolve: async (u: string) => {
      calls++; clock += stepMs
      if (throwSet.has(u)) throw new Error('boom')
      return brokenSet.has(u)
        ? { result: 'broken', finalUrl: null, status: 404, hops: 0, chain: [], tooManyRedirects: false }
        : { result: 'ok', finalUrl: u, status: 200, hops: 0, chain: [], tooManyRedirects: false }
    },
    resolveExternal: async (u: string) => ({ result: 'ok', finalUrl: u, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
    now: () => clock,
    sleep: async () => {},
  }
  return { deps, getCalls: () => calls }
}

const liveRun = (id: string) =>
  prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId: id, tool: 'seo-parser' } },
    include: { findings: true },
  })
const brokenCount = (r: NonNullable<Awaited<ReturnType<typeof liveRun>>>) =>
  r.findings.find((f) => f.scope === 'run' && f.type === 'broken_internal_links')?.count ?? 0

describe('runBrokenLinkVerify — internal time budget', () => {
  it('budget trips mid-internal -> partial run written; only resolved targets counted', async () => {
    vi.stubEnv('BROKEN_LINK_CONCURRENCY', '1')          // deterministic sequential resolves
    vi.stubEnv('BROKEN_LINK_EXTERNAL_MAX_CHECKS', '0')  // isolate the internal pass
    vi.stubEnv('BROKEN_LINK_INTERNAL_TIME_BUDGET_MS', '250000')
    const id = await seedInternal(10)
    // ALL 10 targets would resolve 'broken'; step 100_000/resolve, deadline 250_000
    // -> checks at 0,100k,200k resolve p0,p1,p2, then 300k>=250k trips. 3 resolved.
    const { deps, getCalls } = makeDeps({ stepMs: 100_000, brokenSet: new Set(Array.from({ length: 10 }, (_, i) => url(i))) })
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)
    const run = await liveRun(id)
    expect(run).not.toBeNull()                 // the whole point: run got written
    expect(run!.status).toBe('partial')        // budget-hit -> partial
    expect(getCalls()).toBe(3)                 // only 3 launched
    expect(brokenCount(run!)).toBe(3)          // unresolved 7 NOT counted
    expect(await prisma.harvestedLink.count({ where: { siteAuditId: id } })).toBe(0) // transient cleaned
  })

  it('no time pressure -> complete run, all targets resolved (regression guard)', async () => {
    vi.stubEnv('BROKEN_LINK_CONCURRENCY', '1')
    vi.stubEnv('BROKEN_LINK_EXTERNAL_MAX_CHECKS', '0')
    const id = await seedInternal(5)
    const { deps, getCalls } = makeDeps({ stepMs: 0, brokenSet: new Set(Array.from({ length: 5 }, (_, i) => url(i))) })
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps) // clock never advances
    const run = await liveRun(id)
    expect(run!.status).toBe('complete')
    expect(getCalls()).toBe(5)                 // all resolved
    expect(brokenCount(run!)).toBe(5)
  })

  it('deadline <= 0 (no time left) -> zero internal checks, partial run still written', async () => {
    vi.stubEnv('BROKEN_LINK_CONCURRENCY', '1')
    vi.stubEnv('BROKEN_LINK_EXTERNAL_MAX_CHECKS', '1')          // external enabled -> its budget is reserved
    vi.stubEnv('BROKEN_LINK_EXTERNAL_TIME_BUDGET_MS', '900000') // reserve >= JOB_TIMEOUT -> internal deadline clamps to 0
    const id = await seedInternal(5)
    const { deps, getCalls } = makeDeps({ stepMs: 100_000 })
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)
    const run = await liveRun(id)
    expect(run).not.toBeNull()
    expect(run!.status).toBe('partial')
    expect(getCalls()).toBe(0)                 // zero internal resolves launched
  })

  it('internal resolve throws -> isolated to that target, run still written (failure isolation)', async () => {
    vi.stubEnv('BROKEN_LINK_CONCURRENCY', '1')
    vi.stubEnv('BROKEN_LINK_EXTERNAL_MAX_CHECKS', '0')
    const id = await seedInternal(2)
    // p0 throws, p1 resolves broken. No budget pressure (step 0).
    const { deps } = makeDeps({ stepMs: 0, throwSet: new Set([url(0)]), brokenSet: new Set([url(1)]) })
    await expect(runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)).resolves.toBeUndefined()
    const run = await liveRun(id)
    expect(run).not.toBeNull()                 // a throw in one resolve did not sink the run
    expect(run!.status).toBe('complete')       // a throw is unconfirmed, not a partial trigger
    expect(brokenCount(run!)).toBe(1)          // p1 counted; p0 (threw -> unconfirmed) not broken
  })
})
