// app/api/site-audit/[id]/report/route.test.ts
//
// DB-backed tests for the C4 report POST (enqueue) + GET (download) routes.
// Real SiteAudit/CrawlRun rows (domain prefix c4rep-); the durable queue is
// partial-mocked so no job ever actually runs; REPORTS_DIR → tmpdir.
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

vi.mock('@/lib/jobs/queue', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/jobs/queue')>()
  return {
    ...actual,
    enqueueJob: vi.fn(),
    countActiveJobsByGroup: vi.fn(),
  }
})

const { prisma } = await import('@/lib/db')
const { enqueueJob } = await import('@/lib/jobs/queue')
const { reportPath } = await import('@/lib/report/report-file')
const { POST, GET } = await import('./route')

const PREFIX = 'c4rep-'
const siteAuditIds: string[] = []
let tmpDir: string

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function post(id: string) {
  return POST(new NextRequest(`http://localhost/api/site-audit/${id}/report`, { method: 'POST' }), makeParams(id))
}

function get(id: string) {
  return GET(new NextRequest(`http://localhost/api/site-audit/${id}/report`), makeParams(id))
}

async function seedAudit(opts: { name: string; status?: string; withRun?: boolean; completedAt?: Date | null }) {
  const domain = `${PREFIX}${opts.name}.example`
  const audit = await prisma.siteAudit.create({
    data: {
      domain,
      status: opts.status ?? 'complete',
      wcagLevel: 'wcag21aa',
      completedAt: opts.completedAt === undefined ? new Date('2026-06-01T00:00:00Z') : opts.completedAt,
    },
  })
  siteAuditIds.push(audit.id)
  if (opts.withRun !== false) {
    await prisma.crawlRun.create({
      data: {
        tool: 'ada-audit', source: 'site-audit', domain, wcagLevel: 'wcag21aa',
        status: 'complete', completedAt: new Date('2026-06-01T00:00:00Z'),
        siteAuditId: audit.id,
      },
    })
  }
  return audit
}

beforeAll(async () => {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
})

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'er-report-route-'))
  vi.stubEnv('REPORTS_DIR', tmpDir)
  vi.mocked(enqueueJob).mockReset()
  vi.mocked(enqueueJob).mockResolvedValue({ id: 'job-1', deduped: false })
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

afterAll(async () => {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  if (siteAuditIds.length) {
    await prisma.siteAudit.deleteMany({ where: { id: { in: siteAuditIds } } })
  }
})

describe('POST /api/site-audit/[id]/report', () => {
  it('queues a report-render job for a complete audit with a findings run', async () => {
    const audit = await seedAudit({ name: 'post-ok' })
    const res = await post(audit.id)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ queued: true })
    expect(enqueueJob).toHaveBeenCalledTimes(1)
    expect(enqueueJob).toHaveBeenCalledWith({
      type: 'report-render',
      payload: { siteAuditId: audit.id },
      dedupKey: `report:${audit.id}`,
      groupKey: `report:${audit.id}`,
    })
  })

  it('409s not_complete on a non-complete audit', async () => {
    const audit = await seedAudit({ name: 'post-running', status: 'running', completedAt: null })
    const res = await post(audit.id)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'not_complete' })
    expect(enqueueJob).not.toHaveBeenCalled()
  })

  it('409s no_findings_run on a pre-A2 audit (no CrawlRun)', async () => {
    const audit = await seedAudit({ name: 'post-prea2', withRun: false })
    const res = await post(audit.id)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'no_findings_run' })
    expect(enqueueJob).not.toHaveBeenCalled()
  })

  it('404s an unknown audit', async () => {
    const res = await post('c4rep-no-such-id')
    expect(res.status).toBe(404)
    expect(enqueueJob).not.toHaveBeenCalled()
  })

  it('500s enqueue_failed when enqueueJob throws', async () => {
    const audit = await seedAudit({ name: 'post-enqfail' })
    vi.mocked(enqueueJob).mockRejectedValue(new Error('db locked'))
    const res = await post(audit.id)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'enqueue_failed' })
  })
})

describe('GET /api/site-audit/[id]/report', () => {
  it('streams the PDF with the branded filename when the file exists', async () => {
    const audit = await seedAudit({ name: 'get-ok' })
    await fs.writeFile(reportPath(audit.id), Buffer.from('%PDF-fake'))
    const res = await get(audit.id)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    const cd = res.headers.get('Content-Disposition') ?? ''
    expect(cd).toContain(`filename="ada-report-${PREFIX}get-ok.example-2026-06-01.pdf"`)
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('%PDF-fake')
  })

  it('404s report_not_generated when no file is on disk', async () => {
    const audit = await seedAudit({ name: 'get-nofile' })
    const res = await get(audit.id)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'report_not_generated' })
  })

  it('404s an unknown audit', async () => {
    const res = await get('c4rep-no-such-id')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Site audit not found' })
  })
})
