// lib/services/client-schedules.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { pageFindingKey, normalizeFindingUrl } from '@/lib/findings/keys'
import { getClientSchedules } from './client-schedules'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '@/lib/jobs/handlers/scheduled-site-audit'

const PREFIX = 'c2sched-svc-'
let clientId: number

beforeAll(async () => {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } }) // cascades stale schedules
  const client = await prisma.client.create({
    data: { name: `${PREFIX}client`, domains: JSON.stringify([`${PREFIX}a.example.edu`]) },
  })
  clientId = client.id
})

afterAll(async () => {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } }) // cascades schedules
})

async function makeScheduledAudit(
  scheduleId: string, createdAt: Date, status: string, score: number | null, scoreBreakdown?: string | null,
) {
  const audit = await prisma.siteAudit.create({
    data: {
      domain: `${PREFIX}a.example.edu`, status, wcagLevel: 'wcag21aa',
      scheduleId, createdAt, completedAt: status === 'complete' ? createdAt : null,
    },
  })
  if (score !== null) {
    await prisma.crawlRun.create({
      data: {
        tool: 'ada-audit', source: 'site-audit', status: 'complete', domain: `${PREFIX}a.example.edu`,
        siteAuditId: audit.id, score, scoreBreakdown: scoreBreakdown ?? null,
      },
    })
  }
  return audit
}

describe('getClientSchedules', () => {
  it('returns [] for a client with no schedules', async () => {
    expect(await getClientSchedules(clientId)).toEqual([])
  })

  it('joins last run + CrawlRun score + delta vs previous completed scheduled run', async () => {
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId, cadence: 'weekly:1@06:00',
        payload: JSON.stringify({ clientId, domain: `${PREFIX}a.example.edu`, wcagLevel: 'wcag22aa' }),
        nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    await makeScheduledAudit(sched.id, new Date('2026-04-01T00:00:00Z'), 'complete', 70)
    await makeScheduledAudit(sched.id, new Date('2026-05-01T00:00:00Z'), 'complete', 82)

    const rows = await getClientSchedules(clientId)
    expect(rows).toHaveLength(1)
    expect(rows[0].domain).toBe(`${PREFIX}a.example.edu`)
    expect(rows[0].wcagLevel).toBe('wcag22aa')
    expect(rows[0].cadence).toBe('weekly:1@06:00')
    expect(rows[0].enabled).toBe(true)
    expect(rows[0].lastRun?.score).toBe(82)
    expect(rows[0].lastDelta).toBe(12)
  })

  it('lastDelta is null when the latest run is not complete or only one scored run exists', async () => {
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId, cadence: 'monthly:1@06:00',
        payload: JSON.stringify({ clientId, domain: `${PREFIX}a.example.edu`, wcagLevel: 'wcag21aa' }),
        nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    await makeScheduledAudit(sched.id, new Date('2026-05-20T00:00:00Z'), 'complete', 75)
    const oneRun = (await getClientSchedules(clientId)).find((r) => r.id === sched.id)!
    expect(oneRun.lastRun?.score).toBe(75)
    expect(oneRun.lastDelta).toBeNull()

    await makeScheduledAudit(sched.id, new Date('2026-06-01T00:00:00Z'), 'error', null)
    const afterError = (await getClientSchedules(clientId)).find((r) => r.id === sched.id)!
    expect(afterError.lastRun?.status).toBe('error')
    expect(afterError.lastDelta).toBeNull()
  })

  it('suppresses lastDelta across a v1→v2 score-formula boundary (C9-A)', async () => {
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId, cadence: 'weekly:7@06:00',
        payload: JSON.stringify({ clientId, domain: `${PREFIX}a.example.edu`, wcagLevel: 'wcag21aa' }),
        nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    // v1 (no scoreBreakdown) → v2 (scoreBreakdown.version = 2): numeric
    // score delta would be 20, but formulas differ so it must be suppressed.
    await makeScheduledAudit(sched.id, new Date('2026-04-01T00:00:00Z'), 'complete', 70, null)
    await makeScheduledAudit(sched.id, new Date('2026-05-01T00:00:00Z'), 'complete', 90, JSON.stringify({ version: 2 }))
    const row = (await getClientSchedules(clientId)).find((r) => r.id === sched.id)!
    expect(row.lastRun?.score).toBe(90)
    expect(row.lastDelta).toBeNull()
  })

  it('does not surface non-scan schedules attached to the client', async () => {
    await prisma.schedule.create({
      data: { jobType: 'cleanup', clientId, cadence: 'daily@09:00', payload: '{}', nextRunAt: new Date('2099-01-01T00:00:00Z') },
    })
    const rows = await getClientSchedules(clientId)
    expect(rows.every((r) => r.cadence !== 'daily@09:00')).toBe(true)
  })

  it('renders a row with empty domain on malformed payload instead of throwing', async () => {
    const sched = await prisma.schedule.create({
      data: {
        jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId, cadence: 'weekly:2@07:00',
        payload: '{nope', nextRunAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    const row = (await getClientSchedules(clientId)).find((r) => r.id === sched.id)
    expect(row).toBeDefined()
    expect(row!.domain).toBe('')
    expect(row!.wcagLevel).toBe('wcag21aa')
  })
})

// ── C3: instance new/resolved chips ─────────────────────────────────────────

async function makeSchedule(cadence: string) {
  return prisma.schedule.create({
    data: {
      jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId, cadence,
      payload: JSON.stringify({ clientId, domain: `${PREFIX}a.example.edu`, wcagLevel: 'wcag21aa' }),
      nextRunAt: new Date('2099-01-01T00:00:00Z'),
    },
  })
}

// Like makeScheduledAudit, but always creates the CrawlRun (score nullable)
// with a wcagLevel + complete CrawlPages + page-scope Findings using the real
// pageFindingKey so dedupKeys match across runs (the A2 mappers' identity).
async function makeAuditWithRun(
  scheduleId: string,
  createdAt: Date,
  opts: {
    status?: string
    score: number | null
    wcagLevel?: string
    pages?: { url: string; findings?: string[] }[]
  },
) {
  const status = opts.status ?? 'complete'
  const audit = await prisma.siteAudit.create({
    data: {
      domain: `${PREFIX}a.example.edu`, status, wcagLevel: opts.wcagLevel ?? 'wcag21aa',
      scheduleId, createdAt, completedAt: status === 'complete' ? createdAt : null,
    },
  })
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'ada-audit', source: 'site-audit', status: 'complete',
      domain: `${PREFIX}a.example.edu`, siteAuditId: audit.id,
      score: opts.score, wcagLevel: opts.wcagLevel ?? 'wcag21aa',
      completedAt: createdAt,
    },
  })
  for (const p of opts.pages ?? []) {
    const url = normalizeFindingUrl(p.url)
    const page = await prisma.crawlPage.create({
      data: { runId: run.id, url, status: 'complete' },
    })
    for (const type of p.findings ?? []) {
      await prisma.finding.create({
        data: {
          runId: run.id, pageId: page.id, scope: 'page', type,
          severity: 'critical', url, dedupKey: pageFindingKey(type, url),
        },
      })
    }
  }
  return audit
}

describe('getClientSchedules — instance diff chips (C3)', () => {
  const base = `https://${PREFIX}a.example.edu`

  it('newCount/resolvedCount come from the pair diff of the last two completed scored runs', async () => {
    const sched = await makeSchedule('weekly:3@06:00')
    await makeAuditWithRun(sched.id, new Date('2026-04-01T00:00:00Z'), {
      score: 70, pages: [{ url: `${base}/chips`, findings: ['image-alt', 'label'] }],
    })
    await makeAuditWithRun(sched.id, new Date('2026-05-01T00:00:00Z'), {
      score: 82, pages: [{ url: `${base}/chips`, findings: ['label', 'color-contrast'] }],
    })
    const row = (await getClientSchedules(clientId)).find((r) => r.id === sched.id)!
    // label unchanged; color-contrast regressed (new); image-alt resolved
    expect(row.lastRun?.newCount).toBe(1)
    expect(row.lastRun?.resolvedCount).toBe(1)
    expect(row.lastDelta).toBe(12)
  })

  it('both counts are null when the two runs have different wcagLevels', async () => {
    const sched = await makeSchedule('weekly:4@06:00')
    await makeAuditWithRun(sched.id, new Date('2026-04-01T00:00:00Z'), {
      score: 70, wcagLevel: 'wcag22aa',
      pages: [{ url: `${base}/lvl`, findings: ['image-alt'] }],
    })
    await makeAuditWithRun(sched.id, new Date('2026-05-01T00:00:00Z'), {
      score: 82, wcagLevel: 'wcag21aa',
      pages: [{ url: `${base}/lvl`, findings: ['image-alt'] }],
    })
    const row = (await getClientSchedules(clientId)).find((r) => r.id === sched.id)!
    expect(row.lastRun?.newCount).toBeNull()
    expect(row.lastRun?.resolvedCount).toBeNull()
    // The score Δ is not level-gated — only the instance chips are.
    expect(row.lastDelta).toBe(12)
  })

  it('both counts are null with fewer than 2 completed runs', async () => {
    const sched = await makeSchedule('weekly:5@06:00')
    await makeAuditWithRun(sched.id, new Date('2026-05-01T00:00:00Z'), {
      score: 75, pages: [{ url: `${base}/one`, findings: ['image-alt'] }],
    })
    const one = (await getClientSchedules(clientId)).find((r) => r.id === sched.id)!
    expect(one.lastRun?.newCount).toBeNull()
    expect(one.lastRun?.resolvedCount).toBeNull()
    expect(one.lastDelta).toBeNull()

    // A non-complete latest run never gets chips either.
    await makeAuditWithRun(sched.id, new Date('2026-06-01T00:00:00Z'), { status: 'error', score: null })
    const afterError = (await getClientSchedules(clientId)).find((r) => r.id === sched.id)!
    expect(afterError.lastRun?.status).toBe('error')
    expect(afterError.lastRun?.newCount).toBeNull()
    expect(afterError.lastRun?.resolvedCount).toBeNull()
  })

  it('score Δ and chips use the SAME previous audit, skipping null-score crawlRuns consistently', async () => {
    const sched = await makeSchedule('weekly:6@06:00')
    // oldest: scored, image-alt only
    await makeAuditWithRun(sched.id, new Date('2026-04-01T00:00:00Z'), {
      score: 70, pages: [{ url: `${base}/pair`, findings: ['image-alt'] }],
    })
    // intermediate: complete but its crawlRun has a null score → skipped by
    // BOTH the score Δ and the chips (one prevAudit drives both).
    await makeAuditWithRun(sched.id, new Date('2026-05-01T00:00:00Z'), {
      score: null, pages: [{ url: `${base}/pair`, findings: ['label'] }],
    })
    // latest: image-alt unchanged vs oldest + color-contrast new
    await makeAuditWithRun(sched.id, new Date('2026-06-01T00:00:00Z'), {
      score: 82, pages: [{ url: `${base}/pair`, findings: ['image-alt', 'color-contrast'] }],
    })
    const row = (await getClientSchedules(clientId)).find((r) => r.id === sched.id)!
    // vs oldest: Δ = 82 − 70; new = color-contrast only; nothing resolved.
    // (vs the intermediate it would be newCount 2 / resolvedCount 1.)
    expect(row.lastDelta).toBe(12)
    expect(row.lastRun?.newCount).toBe(1)
    expect(row.lastRun?.resolvedCount).toBe(0)
  })
})
