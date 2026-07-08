// lib/ada-audit/seo-phase.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { BROKEN_LINK_VERIFY_JOB_TYPE } from '@/lib/jobs/handlers/broken-link-verify'
import { classifySeoPhase, getLatestSeoVerifyJob, getSeoPhase } from './seo-phase'

describe('classifySeoPhase', () => {
  it('done wins over any job', () => {
    expect(classifySeoPhase({ liveScanRunId: 'run1', job: { status: 'running', progress: 40, progressMessage: 'x' } }))
      .toEqual({ state: 'done', progress: null, message: null })
  })
  it('running carries progress + message', () => {
    expect(classifySeoPhase({ liveScanRunId: null, job: { status: 'running', progress: 40, progressMessage: 'Checked 4/10 links' } }))
      .toEqual({ state: 'running', progress: 40, message: 'Checked 4/10 links' })
  })
  it('queued', () => {
    expect(classifySeoPhase({ liveScanRunId: null, job: { status: 'queued', progress: null, progressMessage: null } }))
      .toEqual({ state: 'queued', progress: null, message: null })
  })
  it('error -> failed', () => {
    expect(classifySeoPhase({ liveScanRunId: null, job: { status: 'error', progress: null, progressMessage: null } }))
      .toEqual({ state: 'failed', progress: null, message: null })
  })
  it('complete-but-no-run -> unavailable', () => {
    expect(classifySeoPhase({ liveScanRunId: null, job: { status: 'complete', progress: 100, progressMessage: null } }))
      .toEqual({ state: 'unavailable', progress: null, message: null })
  })
  it('cancelled -> unavailable', () => {
    expect(classifySeoPhase({ liveScanRunId: null, job: { status: 'cancelled', progress: null, progressMessage: null } }))
      .toEqual({ state: 'unavailable', progress: null, message: null })
  })
  it('no run + no job -> unavailable', () => {
    expect(classifySeoPhase({ liveScanRunId: null, job: null }))
      .toEqual({ state: 'unavailable', progress: null, message: null })
  })
})

describe('getLatestSeoVerifyJob / getSeoPhase (DB-backed)', () => {
  const PREFIX = 'c11pr2b-seoph-'
  const DOMAIN = `${PREFIX}site.example`

  async function cleanPrefixRows() {
    const audits = await prisma.siteAudit.findMany({
      where: { domain: { startsWith: PREFIX } },
      select: { id: true },
    })
    const ids = audits.map((a) => a.id)
    await prisma.crawlRun.deleteMany({ where: { siteAuditId: { in: ids } } })
    await prisma.job.deleteMany({ where: { groupKey: { in: ids.map((id) => `site-audit:${id}`) } } })
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  }

  beforeEach(cleanPrefixRows)
  afterEach(cleanPrefixRows)

  it('returns running when a running verify job exists and no live-scan run yet', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', wcagLevel: 'wcag21aa' },
    })
    await prisma.job.create({
      data: {
        type: BROKEN_LINK_VERIFY_JOB_TYPE,
        groupKey: `site-audit:${site.id}`,
        status: 'running',
        progress: 42,
        progressMessage: 'Checked 42/100 links',
      },
    })

    const job = await getLatestSeoVerifyJob(site.id)
    expect(job).toEqual({ status: 'running', progress: 42, progressMessage: 'Checked 42/100 links' })

    const phase = await getSeoPhase(site.id)
    expect(phase).toEqual({ state: 'running', progress: 42, message: 'Checked 42/100 links' })
  })

  it('returns done once a live-scan CrawlRun exists, regardless of the job row', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', wcagLevel: 'wcag21aa' },
    })
    await prisma.job.create({
      data: {
        type: BROKEN_LINK_VERIFY_JOB_TYPE,
        groupKey: `site-audit:${site.id}`,
        status: 'running',
        progress: 42,
        progressMessage: 'Checked 42/100 links',
      },
    })
    await prisma.crawlRun.create({
      data: {
        siteAuditId: site.id,
        tool: 'seo-parser',
        source: 'live-scan',
        domain: DOMAIN,
        status: 'complete',
      },
    })

    const phase = await getSeoPhase(site.id)
    expect(phase).toEqual({ state: 'done', progress: null, message: null })
  })
})
