// lib/ops/health-check.ts
//
// D0 ops safety — failure detection. `evaluateHealth` is a pure function
// (windowing + cooldowns) that turns collected signals into alert lines +
// next dedup state; `collectHealthSignals` is the only DB/FS-touching part.
// Split so the decision logic is unit-testable without a DB.
import type { AlertState } from './alert-state'
import { prisma } from '@/lib/db'
import { newestBackupMtimeMs } from './backup'

export interface ErroredSiteAuditDetail { id: string; domain: string; error: string | null }
export interface ErroredAdaAuditDetail { id: string; url: string; error: string | null; siteAuditId: string | null }
export interface ExhaustedJobDetail { id: string; type: string; lastError: string | null; groupKey: string | null }

export interface HealthSignals {
  newErroredSiteAudits: number
  newErroredAdaAudits: number
  newExhaustedJobs: number
  erroredSiteAuditDetails: ErroredSiteAuditDetail[]
  erroredAdaAuditDetails: ErroredAdaAuditDetail[]
  exhaustedJobDetails: ExhaustedJobDetail[]
  stalledAudit: { id: string; minutesStuck: number } | null
  newestBackupAgeHours: number | null // null = no backup exists
}

export interface EvalOpts {
  lookbackMs: number
  cooldownMs: number
  backupStaleHours: number
  appUrl: string | null // validated absolute http(s) origin for scan links; null = render no links
}

// Escape & BEFORE < and > — otherwise the &lt;/&gt; produced by the later
// replacements would themselves be re-escaped to &amp;lt;.
function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// For any DB string rendered inside a Slack `code span`: backticks neutralized
// so the text can't break out of the span, then mrkdwn-escaped.
function codeSpanSafe(s: string): string {
  return escapeMrkdwn(s.replace(/`/g, "'"))
}

// Order is load-bearing: collapse → truncate → codeSpanSafe (backticks → escape).
// Truncating before escaping means an entity is never cut mid-way.
function sanitizeErrorText(err: string | null): string {
  const collapsed = (err ?? '').replace(/\s+/g, ' ').trim()
  if (!collapsed) return '(no error message)'
  const truncated = collapsed.length > 140 ? `${collapsed.slice(0, 139)}…` : collapsed
  return codeSpanSafe(truncated)
}

// Display labels (domains/URLs) cap at 60 chars; link targets never truncate.
function label(s: string): string {
  return escapeMrkdwn(s.length > 60 ? `${s.slice(0, 59)}…` : s)
}

function scanLink(appUrl: string | null, path: string): string {
  if (!appUrl) return ''
  return ` — <${new URL(path, appUrl).toString()}|View scan>`
}

export function normalizeAppUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

// 'site-audit:<id>' / 'ada-audit:<id>' group keys name a scan we can link to.
// Explicit about malformed keys: no colon, empty prefix, or empty id → null.
function scanPathFromGroupKey(groupKey: string | null): string | null {
  if (!groupKey) return null
  const i = groupKey.indexOf(':')
  if (i <= 0) return null
  const prefix = groupKey.slice(0, i)
  const id = encodeURIComponent(groupKey.slice(i + 1))
  if (!id) return null
  if (prefix === 'site-audit') return `/ada-audit/site/${id}`
  if (prefix === 'ada-audit') return `/ada-audit/${id}`
  return null
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

  // Counts drive alert PRESENCE (the /api/health degraded flag reads only
  // alerts.length); detail rows only enrich the lines. An empty detail array
  // (race/data drift) falls back to the aggregate count line.
  if (signals.newErroredSiteAudits > 0) {
    const details = signals.erroredSiteAuditDetails
    if (details.length === 0) {
      alerts.push(`• ${signals.newErroredSiteAudits} site audit(s) errored since last check`)
    } else {
      for (const d of details) {
        alerts.push(`• Site audit *${label(d.domain)}* errored: \`${sanitizeErrorText(d.error)}\`${scanLink(opts.appUrl, `/ada-audit/site/${d.id}`)}`)
      }
      const more = signals.newErroredSiteAudits - details.length
      if (more > 0) alerts.push(`  …and ${more} more errored site audit(s)`)
    }
  }

  if (signals.newErroredAdaAudits > 0) {
    const details = signals.erroredAdaAuditDetails
    if (details.length === 0) {
      alerts.push(`• ${signals.newErroredAdaAudits} ADA audit(s) errored since last check`)
    } else {
      for (const d of details) {
        const path = d.siteAuditId ? `/ada-audit/site/${d.siteAuditId}` : `/ada-audit/${d.id}`
        alerts.push(`• ADA audit *${label(d.url)}* errored: \`${sanitizeErrorText(d.error)}\`${scanLink(opts.appUrl, path)}`)
      }
      const more = signals.newErroredAdaAudits - details.length
      if (more > 0) alerts.push(`  …and ${more} more errored ADA audit(s)`)
    }
  }

  if (signals.newExhaustedJobs > 0) {
    const details = signals.exhaustedJobDetails
    if (details.length === 0) {
      alerts.push(`• ${signals.newExhaustedJobs} durable job(s) exhausted retries`)
    } else {
      for (const d of details) {
        const path = scanPathFromGroupKey(d.groupKey)
        alerts.push(`• Job \`${codeSpanSafe(d.type)}\` exhausted retries: \`${sanitizeErrorText(d.lastError)}\`${path ? scanLink(opts.appUrl, path) : ''}`)
      }
      const more = signals.newExhaustedJobs - details.length
      if (more > 0) alerts.push(`  …and ${more} more exhausted job(s)`)
    }
  }

  const onCooldown = (key: string) => nowMs - (cooldowns[key] ?? 0) < opts.cooldownMs

  if (signals.stalledAudit && !onCooldown('queue-stalled')) {
    alerts.push(`• queue stalled: audit ${signals.stalledAudit.id} transient for ${signals.stalledAudit.minutesStuck}m${scanLink(opts.appUrl, `/ada-audit/site/${signals.stalledAudit.id}`)}`)
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
    appUrl: normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL),
  }
}

export async function collectHealthSignals(now: Date, since: number): Promise<HealthSignals> {
  const sinceDate = new Date(since)
  const stallMinutes = Number(process.env.QUEUE_STALL_MINUTES) || 60
  const stallBefore = new Date(now.getTime() - stallMinutes * 60_000)

  const [
    newErroredSiteAudits, newErroredAdaAudits, newExhaustedJobs, stalled, backupMtime,
    erroredSiteAuditDetails, erroredAdaAuditDetails, exhaustedJobDetails,
  ] = await Promise.all([
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
    // Detail rows: same window fields as the counts, newest-first, capped.
    prisma.siteAudit.findMany({
      where: { status: 'error', updatedAt: { gt: sinceDate } },
      orderBy: { updatedAt: 'desc' }, take: 5,
      select: { id: true, domain: true, error: true },
    }),
    prisma.adaAudit.findMany({
      where: { status: 'error', completedAt: { gt: sinceDate } },
      orderBy: { completedAt: 'desc' }, take: 5,
      select: { id: true, url: true, error: true, siteAuditId: true },
    }),
    prisma.job.findMany({
      where: { status: 'error', updatedAt: { gt: sinceDate } },
      orderBy: { updatedAt: 'desc' }, take: 5,
      select: { id: true, type: true, lastError: true, groupKey: true },
    }),
  ])

  return {
    newErroredSiteAudits,
    newErroredAdaAudits,
    newExhaustedJobs,
    erroredSiteAuditDetails,
    erroredAdaAuditDetails,
    exhaustedJobDetails,
    stalledAudit: stalled
      ? { id: stalled.id, minutesStuck: Math.round((now.getTime() - stalled.updatedAt.getTime()) / 60_000) }
      : null,
    newestBackupAgeHours: backupMtime === null ? null : (now.getTime() - backupMtime) / 3_600_000,
  }
}
