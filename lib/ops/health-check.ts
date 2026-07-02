// lib/ops/health-check.ts
//
// D0 ops safety — failure detection. `evaluateHealth` is a pure function
// (windowing + cooldowns) that turns collected signals into alert lines +
// next dedup state; `collectHealthSignals` is the only DB/FS-touching part.
// Split so the decision logic is unit-testable without a DB.
import type { AlertState } from './alert-state'
import { prisma } from '@/lib/db'
import { newestBackupMtimeMs } from './backup'

export interface HealthSignals {
  newErroredSiteAudits: number
  newErroredAdaAudits: number
  newExhaustedJobs: number
  stalledAudit: { id: string; minutesStuck: number } | null
  newestBackupAgeHours: number | null // null = no backup exists
}

export interface EvalOpts {
  lookbackMs: number
  cooldownMs: number
  backupStaleHours: number
}

export function evaluateHealth(
  signals: HealthSignals,
  state: AlertState,
  now: Date,
  opts: EvalOpts,
): { alerts: string[]; nextState: AlertState } {
  const alerts: string[] = []
  const nowMs = now.getTime()
  const cooldowns = { ...state.cooldowns }

  const erroredAudits = signals.newErroredSiteAudits + signals.newErroredAdaAudits
  if (erroredAudits > 0) alerts.push(`• ${erroredAudits} audit(s) errored since last check`)
  if (signals.newExhaustedJobs > 0) alerts.push(`• ${signals.newExhaustedJobs} durable job(s) exhausted retries`)

  const onCooldown = (key: string) => nowMs - (cooldowns[key] ?? 0) < opts.cooldownMs

  if (signals.stalledAudit && !onCooldown('queue-stalled')) {
    alerts.push(`• queue stalled: audit ${signals.stalledAudit.id} transient for ${signals.stalledAudit.minutesStuck}m`)
    cooldowns['queue-stalled'] = nowMs
  }

  const backupStale = signals.newestBackupAgeHours === null || signals.newestBackupAgeHours > opts.backupStaleHours
  if (backupStale && !onCooldown('backup-stale')) {
    alerts.push(
      signals.newestBackupAgeHours === null
        ? '• backup stale: no snapshot found'
        : `• backup stale: newest snapshot ${Math.round(signals.newestBackupAgeHours)}h old`,
    )
    cooldowns['backup-stale'] = nowMs
  }

  return { alerts, nextState: { lastCheckAt: nowMs, cooldowns } }
}

const TRANSIENT_STATUSES = ['queued', 'pending', 'running', 'pdfs-running', 'lighthouse-running']

export function healthEvalOpts(): EvalOpts {
  return {
    lookbackMs: 15 * 60_000,
    cooldownMs: (Number(process.env.ALERT_COOLDOWN_MINUTES) || 360) * 60_000,
    backupStaleHours: Number(process.env.BACKUP_STALE_HOURS) || 26,
  }
}

export async function collectHealthSignals(now: Date, since: number): Promise<HealthSignals> {
  const sinceDate = new Date(since)
  const stallMinutes = Number(process.env.QUEUE_STALL_MINUTES) || 60
  const stallBefore = new Date(now.getTime() - stallMinutes * 60_000)

  const [newErroredSiteAudits, newErroredAdaAudits, newExhaustedJobs, stalled, backupMtime] =
    await Promise.all([
      prisma.siteAudit.count({ where: { status: 'error', updatedAt: { gt: sinceDate } } }),
      // AdaAudit has NO updatedAt — its error paths set completedAt.
      prisma.adaAudit.count({ where: { status: 'error', completedAt: { gt: sinceDate } } }),
      prisma.job.count({ where: { status: 'error', updatedAt: { gt: sinceDate } } }),
      prisma.siteAudit.findFirst({
        where: { status: { in: TRANSIENT_STATUSES }, updatedAt: { lt: stallBefore } },
        orderBy: { updatedAt: 'asc' },
        select: { id: true, updatedAt: true },
      }),
      newestBackupMtimeMs(),
    ])

  return {
    newErroredSiteAudits,
    newErroredAdaAudits,
    newExhaustedJobs,
    stalledAudit: stalled
      ? { id: stalled.id, minutesStuck: Math.round((now.getTime() - stalled.updatedAt.getTime()) / 60_000) }
      : null,
    newestBackupAgeHours: backupMtime === null ? null : (now.getTime() - backupMtime) / 3_600_000,
  }
}
