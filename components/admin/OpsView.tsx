import React from 'react'
import type { OpsSnapshot } from '@/lib/ops/ops-snapshot'

function fmtBytes(n: number | null): string {
  if (n === null || n === undefined) return '—'
  const gb = n / 1_073_741_824
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(n / 1_048_576).toFixed(1)} MB`
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card p-5">
      <h2 className="font-display font-bold text-lg text-navy dark:text-white mb-3">{title}</h2>
      {children}
    </section>
  )
}

const Unavailable = () => (
  <p className="text-sm font-body text-amber-600 dark:text-amber-400">Section unavailable (loader failed).</p>
)

export function OpsView({ snapshot }: { snapshot: OpsSnapshot }) {
  const { queue, cleanup, health, disk, dbSize, pool } = snapshot
  return (
    <div className="space-y-2">
      <Card title="System">
        {/* A failed loader renders "unavailable", distinct from a null metric ("—")
            which means "measured, not available on this host". */}
        <dl className="grid grid-cols-2 gap-2 text-sm font-body text-gray-700 dark:text-white/70">
          <dt>Disk free</dt>
          <dd>{disk.ok ? fmtBytes(disk.data) : <span className="text-amber-600 dark:text-amber-400">unavailable</span>}</dd>
          <dt>DB footprint (main+WAL)</dt>
          <dd>{dbSize.ok ? fmtBytes(dbSize.data) : <span className="text-amber-600 dark:text-amber-400">unavailable</span>}</dd>
        </dl>
      </Card>

      <Card title="Browser pool">
        {pool.ok ? (
          <dl className="grid grid-cols-2 gap-2 text-sm font-body text-gray-700 dark:text-white/70">
            <dt>In use / size</dt><dd>{pool.data.inUse} / {pool.data.poolSize}</dd>
            <dt>Waiting</dt><dd>{pool.data.waiting}</dd>
            <dt>Draining</dt><dd>{String(pool.data.draining)}</dd>
            <dt>Browser alive</dt><dd>{String(pool.data.browserAlive)}</dd>
            <dt>Pages served</dt><dd>{pool.data.pagesServed}</dd>
          </dl>
        ) : <Unavailable />}
      </Card>

      <Card title="Health signals">
        {health.ok ? (
          <div className="text-sm font-body text-gray-700 dark:text-white/70">
            <p className={health.data.degraded ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-green-600 dark:text-green-400 font-semibold'}>
              {health.data.degraded ? 'Degraded' : 'OK'}
            </p>
            <dl className="grid grid-cols-2 gap-2 mt-2">
              <dt>Errored site audits (window)</dt><dd>{health.data.signals.newErroredSiteAudits}</dd>
              <dt>Errored ADA audits (window)</dt><dd>{health.data.signals.newErroredAdaAudits}</dd>
              <dt>Exhausted jobs (window)</dt><dd>{health.data.signals.newExhaustedJobs}</dd>
              <dt>Stalled audit</dt><dd>{health.data.signals.stalledAudit ? `${health.data.signals.stalledAudit.id} (${health.data.signals.stalledAudit.minutesStuck}m)` : 'none'}</dd>
              <dt>Newest backup age</dt><dd>{health.data.signals.newestBackupAgeHours === null ? '—' : `${Math.round(health.data.signals.newestBackupAgeHours)}h`}</dd>
            </dl>
          </div>
        ) : <Unavailable />}
      </Card>

      <Card title="Job queue">
        {queue.ok ? (
          <div className="text-sm font-body text-gray-700 dark:text-white/70">
            <table className="w-full text-left">
              <thead><tr className="text-gray-500 dark:text-white/50"><th>Type</th><th>Status counts</th></tr></thead>
              <tbody>
                {Object.entries(queue.data.counts).map(([type, byStatus]) => (
                  <tr key={type} className="border-t border-gray-100 dark:border-navy-border">
                    <td className="py-1">{type}</td>
                    <td className="py-1">{Object.entries(byStatus).map(([s, c]) => `${s}:${c}`).join('  ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2">Oldest running: {queue.data.oldestRunning ? `${queue.data.oldestRunning.type} ${queue.data.oldestRunning.id}` : 'none'}</p>
            {queue.data.recentFailures.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {queue.data.recentFailures.map((f) => (
                  <li key={f.id}>{f.type}: {f.lastError ?? 'error'}</li>
                ))}
              </ul>
            )}
          </div>
        ) : <Unavailable />}
      </Card>

      <Card title="Maintenance (last run)">
        {cleanup.ok ? (
          <dl className="grid grid-cols-2 gap-2 text-sm font-body text-gray-700 dark:text-white/70">
            {cleanup.data.map((c) => (
              <React.Fragment key={c.type}>
                <dt>{c.type}</dt>
                <dd>
                  {c.lastCompletedAt ? new Date(c.lastCompletedAt).toISOString() : '—'}
                  {c.lastStatus ? ` [${c.lastStatus}]` : ''}
                  {c.lastError ? ` (err: ${c.lastError})` : ''}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        ) : <Unavailable />}
      </Card>
    </div>
  )
}
