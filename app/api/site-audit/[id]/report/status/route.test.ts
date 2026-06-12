// app/api/site-audit/[id]/report/status/route.test.ts
//
// Status contract: 'rendering' while a report:<id> job is active; 'ready'
// ONLY when reportGeneratedAt AND the file agree (Codex fix #6 — never trust
// the column alone); else 'none'. Prefix c4rep-; queue partial-mocked.
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
const { countActiveJobsByGroup } = await import('@/lib/jobs/queue')
const { reportPath } = await import('@/lib/report/report-file')
const { GET } = await import('./route')

const PREFIX = 'c4rep-status-'
const siteAuditIds: string[] = []
let tmpDir: string

function get(id: string) {
  return GET(
    new NextRequest(`http://localhost/api/site-audit/${id}/report/status`),
    { params: Promise.resolve({ id }) },
  )
}

async function seedAudit(name: string, reportGeneratedAt: Date | null = null) {
  const audit = await prisma.siteAudit.create({
    data: {
      domain: `${PREFIX}${name}.example`,
      status: 'complete',
      wcagLevel: 'wcag21aa',
      completedAt: new Date('2026-06-01T00:00:00Z'),
      reportGeneratedAt,
    },
  })
  siteAuditIds.push(audit.id)
  return audit
}

beforeAll(async () => {
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
})

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'er-report-status-'))
  vi.stubEnv('REPORTS_DIR', tmpDir)
  vi.mocked(countActiveJobsByGroup).mockReset()
  vi.mocked(countActiveJobsByGroup).mockResolvedValue(0)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

afterAll(async () => {
  if (siteAuditIds.length) {
    await prisma.siteAudit.deleteMany({ where: { id: { in: siteAuditIds } } })
  }
})

describe('GET /api/site-audit/[id]/report/status', () => {
  it('404s an unknown audit', async () => {
    const res = await get('c4rep-status-no-such-id')
    expect(res.status).toBe(404)
  })

  it('none: no active job, no stamp', async () => {
    const audit = await seedAudit('none')
    const res = await get(audit.id)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ state: 'none', generatedAt: null })
  })

  it('rendering: an active report:<id> job wins', async () => {
    const audit = await seedAudit('rendering')
    vi.mocked(countActiveJobsByGroup).mockResolvedValue(1)
    const res = await get(audit.id)
    expect(await res.json()).toEqual({ state: 'rendering', generatedAt: null })
    expect(countActiveJobsByGroup).toHaveBeenCalledWith(`report:${audit.id}`)
  })

  it('ready: stamp set AND file on disk', async () => {
    const stamp = new Date('2026-06-11T12:00:00Z')
    const audit = await seedAudit('ready', stamp)
    await fs.writeFile(reportPath(audit.id), Buffer.from('%PDF-fake'))
    const res = await get(audit.id)
    expect(await res.json()).toEqual({ state: 'ready', generatedAt: stamp.toISOString() })
  })

  it('none: stamp set but NO file — never trust the column alone', async () => {
    const audit = await seedAudit('stamp-nofile', new Date('2026-06-11T12:00:00Z'))
    const res = await get(audit.id)
    expect(await res.json()).toEqual({ state: 'none', generatedAt: null })
  })
})
