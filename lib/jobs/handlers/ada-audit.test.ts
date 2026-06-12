// lib/jobs/handlers/ada-audit.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/ada-audit/runner', () => ({ runAxeAudit: vi.fn() }))
vi.mock('@/lib/ada-audit/pdf-orchestrator', () => ({ dispatchPdfScans: vi.fn(async () => undefined) }))
vi.mock('@/lib/findings/ada-write', () => ({ writeAdaSingleFindings: vi.fn(async () => undefined) }))

const { prisma } = await import('@/lib/db')
const { runAxeAudit } = await import('@/lib/ada-audit/runner')
const { dispatchPdfScans } = await import('@/lib/ada-audit/pdf-orchestrator')
const { writeAdaSingleFindings } = await import('@/lib/findings/ada-write')
const { runAdaAuditJob, onAdaAuditExhausted, failStandaloneAudit } = await import('./ada-audit')

const PREFIX = 'ada-handler-test-'

async function clearTestState() {
  await prisma.adaAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
}

async function seed(name: string, status = 'pending') {
  const audit = await prisma.adaAudit.create({
    data: { url: `https://${PREFIX}${name}.example/p`, status, wcagLevel: 'wcag21aa' },
  })
  return { audit, payload: { adaAuditId: audit.id, url: audit.url, wcagLevel: 'wcag21aa' } }
}

const AXE_OK = {
  kind: 'audited' as const,
  axe: { violations: [] } as never,
  lighthouseSummary: null,
  lighthouseError: null,
  harvestedPdfUrls: [] as string[],
}

describe('jobs/handlers/ada-audit', () => {
  beforeEach(async () => {
    vi.mocked(runAxeAudit).mockReset()
    vi.mocked(dispatchPdfScans).mockReset()
    vi.mocked(dispatchPdfScans).mockResolvedValue(undefined)
    vi.mocked(writeAdaSingleFindings).mockClear()
    vi.mocked(writeAdaSingleFindings).mockResolvedValue(undefined as never)
    await clearTestState()
  })

  afterAll(clearTestState)

  it('rejects an invalid payload', async () => {
    await expect(runAdaAuditJob({ adaAuditId: 'x' })).rejects.toThrow('Invalid ada-audit job payload')
  })

  it('audited: dispatches PDFs while still running, then settles complete and dual-writes', async () => {
    const { audit, payload } = await seed('ok')
    let statusAtDispatch: string | undefined
    vi.mocked(runAxeAudit).mockResolvedValue({
      ...AXE_OK,
      lighthouseSummary: { performance: 80 } as never,
      harvestedPdfUrls: ['https://x.example/a.pdf'],
    })
    vi.mocked(dispatchPdfScans).mockImplementation(async () => {
      const row = await prisma.adaAudit.findUnique({ where: { id: audit.id }, select: { status: true } })
      statusAtDispatch = row?.status
    })
    await runAdaAuditJob(payload)
    // Dispatch-before-settle invariant: the row was still 'running' at dispatch time.
    expect(statusAtDispatch).toBe('running')
    expect(dispatchPdfScans).toHaveBeenCalledWith({
      urls: ['https://x.example/a.pdf'],
      adaAuditId: audit.id,
      sourcePageUrl: payload.url,
    })
    const row = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(row?.status).toBe('complete')
    expect(row?.result).toBe(JSON.stringify(AXE_OK.axe))
    expect(row?.lighthouseSummary).toBe(JSON.stringify({ performance: 80 }))
    expect(row?.runnerType).toBe('browser')
    expect(row?.progress).toBe(100)
    expect(row?.completedAt).not.toBeNull()
    expect(writeAdaSingleFindings).toHaveBeenCalledWith(audit.id)
  })

  it('redirected: settles with finalUrl + runnerType browser and dual-writes', async () => {
    const { audit, payload } = await seed('redir')
    vi.mocked(runAxeAudit).mockResolvedValue({ kind: 'redirected' as const, finalUrl: 'https://moved.example/' } as never)
    await runAdaAuditJob(payload)
    const row = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(row?.status).toBe('redirected')
    expect(row?.finalUrl).toBe('https://moved.example/')
    expect(row?.redirected).toBe(true)
    expect(row?.runnerType).toBe('browser')
    expect(row?.progress).toBe(100)
    expect(writeAdaSingleFindings).toHaveBeenCalledWith(audit.id)
    expect(dispatchPdfScans).not.toHaveBeenCalled()
  })

  it('runAxeAudit throwing is a domain result: settles error, does not throw, no dual-write', async () => {
    const { audit, payload } = await seed('domerr')
    vi.mocked(runAxeAudit).mockRejectedValue(new Error('nav failed'))
    await expect(runAdaAuditJob(payload)).resolves.toBeUndefined()
    const row = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(row?.status).toBe('error')
    expect(row?.error).toBe('nav failed')
    expect(row?.completedAt).not.toBeNull()
    expect(writeAdaSingleFindings).not.toHaveBeenCalled()
  })

  it('claim no-op: a settled row is never re-audited', async () => {
    const { payload } = await seed('settled', 'complete')
    await runAdaAuditJob(payload)
    expect(runAxeAudit).not.toHaveBeenCalled()
  })

  it('re-claims a running row (crash re-run)', async () => {
    const { audit, payload } = await seed('rerun', 'running')
    vi.mocked(runAxeAudit).mockResolvedValue(AXE_OK)
    await runAdaAuditJob(payload)
    const row = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(row?.status).toBe('complete')
  })

  it('late settle no-ops: recovery flips the row terminal mid-run, settle matches zero rows', async () => {
    const { audit, payload } = await seed('late')
    vi.mocked(runAxeAudit).mockImplementation(async () => {
      // Simulate recovery winning the race while the audit runs.
      await prisma.adaAudit.update({
        where: { id: audit.id },
        data: { status: 'error', error: 'recovered', completedAt: new Date() },
      })
      return AXE_OK
    })
    await runAdaAuditJob(payload)
    const row = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(row?.status).toBe('error')
    expect(row?.error).toBe('recovered')
    expect(writeAdaSingleFindings).not.toHaveBeenCalled()
  })

  it('progress writes are fenced: zombie onProgress cannot touch a terminal row', async () => {
    const { audit, payload } = await seed('zombie')
    let captured: ((p: number, m: string) => Promise<void>) | undefined
    vi.mocked(runAxeAudit).mockImplementation(async (_u, _w, onProgress) => {
      captured = onProgress as typeof captured
      await captured?.(50, 'Halfway')
      return AXE_OK
    })
    await runAdaAuditJob(payload)
    const settled = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(settled?.status).toBe('complete')
    expect(settled?.progress).toBe(100)
    // Zombie write after terminal settle: must match zero rows.
    await captured?.(75, 'zombie write')
    const after = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(after?.progress).toBe(100)
    expect(after?.progressMessage).toBe('Complete')
  })

  it('onExhausted flips pending/running to error with the attempts message', async () => {
    const { audit, payload } = await seed('exhausted', 'running')
    await onAdaAuditExhausted(payload, { jobId: 'j1', attempts: 3, lastError: 'timeout' })
    const row = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(row?.status).toBe('error')
    expect(row?.error).toBe('Audit job failed after 3 attempts: timeout')
  })

  it('onExhausted never clobbers a terminal row', async () => {
    const { audit, payload } = await seed('exh-term', 'complete')
    await onAdaAuditExhausted(payload, { jobId: 'j1', attempts: 3, lastError: 'timeout' })
    const row = await prisma.adaAudit.findUnique({ where: { id: audit.id } })
    expect(row?.status).toBe('complete')
    expect(row?.error).toBeNull()
  })

  it('failStandaloneAudit never touches site-audit children', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}site`, status: 'running', wcagLevel: 'wcag21aa' },
    })
    const child = await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}child.example/p`, status: 'running', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await failStandaloneAudit(child.id, 'nope')
    const row = await prisma.adaAudit.findUnique({ where: { id: child.id } })
    expect(row?.status).toBe('running')
  })

  it('the claim no-ops on a site-audit child (malformed/manual job)', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}claimsite`, status: 'running', wcagLevel: 'wcag21aa' },
    })
    const child = await prisma.adaAudit.create({
      data: { url: `https://${PREFIX}claimchild.example/p`, status: 'pending', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
    })
    await runAdaAuditJob({ adaAuditId: child.id, url: child.url, wcagLevel: 'wcag21aa' })
    expect(runAxeAudit).not.toHaveBeenCalled()
    const row = await prisma.adaAudit.findUnique({ where: { id: child.id } })
    expect(row?.status).toBe('pending')
  })
})
