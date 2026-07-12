// lib/jobs/handlers/ada-audit.emit.test.ts
//
// A5 PR2 Task 17 fix: standalone single-page ADA audits report progress by
// writing AdaAudit.progress/progressMessage directly in their own onProgress
// callback — they never touch Job.progress, so the durable-queue worker's
// heartbeat delta emit (lib/jobs/worker.ts flushJobHeartbeat) never fires for
// this job type. Without an emit of its own, AuditPoller (subscribed to
// adaAuditTopic(id)) would only ever see running -> complete with no
// intermediate progress, relying on the 30s safety poll.
//
// Separate file from ada-audit.test.ts (which does not mock the bus) so the
// emit can be asserted without disturbing the large existing suite — same
// precedent as broken-link-verify.emit.test.ts (Task 14).
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

vi.mock('@/lib/events/bus', () => ({ publishInvalidation: vi.fn() }))
vi.mock('@/lib/ada-audit/runner', () => ({ runAxeAudit: vi.fn() }))
vi.mock('@/lib/ada-audit/pdf-orchestrator', () => ({ dispatchPdfScans: vi.fn(async () => undefined) }))
vi.mock('@/lib/findings/ada-write', () => ({ writeAdaSingleFindings: vi.fn(async () => undefined) }))

const { prisma } = await import('@/lib/db')
const { runAxeAudit } = await import('@/lib/ada-audit/runner')
const { dispatchPdfScans } = await import('@/lib/ada-audit/pdf-orchestrator')
const { publishInvalidation } = await import('@/lib/events/bus')
const { adaAuditTopic, recentsTopic } = await import('@/lib/events/topics')
const { runAdaAuditJob } = await import('./ada-audit')

const PREFIX = 'ada-emit-test-'

async function clearTestState() {
  await prisma.adaAudit.deleteMany({ where: { url: { contains: PREFIX } } })
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

describe('jobs/handlers/ada-audit — progress emit (Task 17 fix)', () => {
  beforeEach(async () => {
    vi.mocked(runAxeAudit).mockReset()
    vi.mocked(dispatchPdfScans).mockReset()
    vi.mocked(dispatchPdfScans).mockResolvedValue(undefined)
    vi.mocked(publishInvalidation).mockClear()
    await clearTestState()
  })

  afterAll(clearTestState)

  it('emits ada-audit:<id> and recents after a progress write that took effect', async () => {
    const { audit, payload } = await seed('ok')
    vi.mocked(runAxeAudit).mockImplementation(async (_u, _w, onProgress) => {
      await onProgress?.(50, 'Halfway')
      return AXE_OK
    })
    await runAdaAuditJob(payload)

    const calls = vi.mocked(publishInvalidation).mock.calls.map((c) => c[0])
    expect(calls).toContain(adaAuditTopic(audit.id))
    expect(calls).toContain(recentsTopic())
  })

  it('does not emit for a progress write that lost the running fence', async () => {
    const { audit, payload } = await seed('zombie')
    vi.mocked(runAxeAudit).mockImplementation(async (_u, _w, onProgress) => {
      // Recovery flips the row terminal mid-run, winning the race.
      await prisma.adaAudit.update({
        where: { id: audit.id },
        data: { status: 'error', error: 'recovered', completedAt: new Date() },
      })
      await onProgress?.(75, 'zombie write')
      return AXE_OK
    })
    await runAdaAuditJob(payload)

    const calls = vi.mocked(publishInvalidation).mock.calls.map((c) => c[0])
    expect(calls).not.toContain(adaAuditTopic(audit.id))
  })
})
