// components/clients/ClientHeader.tsx
//
// Dashboard header: name, domain chips, seed-URL count, Teamwork link,
// scheduled-scan line, Edit link. Read-only (Phase 1a) — editing lives at
// /clients/manage.

import { StatusPill } from '@/components/ui/StatusPill'

const JOB_TYPE_LABELS: Record<string, string> = { 'scheduled-site-audit': 'site audit' }

export interface ClientHeaderProps {
  name: string
  domains: string[]
  seedUrls: string[]
  teamworkTasklistId: string | null
  schedules: { jobType: string; cadence: string; nextRunAt: string }[]
  archivedAt?: string | null
}

export function ClientHeader({ name, domains, seedUrls, teamworkTasklistId, schedules, archivedAt }: ClientHeaderProps) {
  return (
    <div className="mb-8">
      <a href="/clients" className="text-xs text-gray-400 dark:text-white/40 hover:text-orange transition-colors">
        ← Clients
      </a>
      <div className="flex flex-wrap items-center justify-between gap-3 mt-1">
        <h1 className="text-3xl font-display font-bold text-navy dark:text-white flex items-center gap-3">
          {name}
          {archivedAt && <StatusPill label="ARCHIVED" tone="neutral" />}
        </h1>
        <a
          href="/clients/manage"
          className="text-sm font-semibold text-orange hover:text-orange-dark transition-colors"
        >
          Edit client →
        </a>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {domains.map((d) => (
          <span key={d} className="px-2 py-0.5 rounded bg-gray-100 dark:bg-white/10 text-xs text-gray-600 dark:text-white/60">
            {d}
          </span>
        ))}
        {seedUrls.length > 0 && (
          <span title={seedUrls.join('\n')} className="text-xs text-gray-400 dark:text-white/40">
            {seedUrls.length} seed URL{seedUrls.length === 1 ? '' : 's'}
          </span>
        )}
        {teamworkTasklistId && (
          <a
            href={`https://enrollmentresources.teamwork.com/app/tasklists/${teamworkTasklistId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-orange hover:text-orange-dark"
          >
            Teamwork ↗
          </a>
        )}
      </div>
      <p className="mt-1.5 text-xs text-gray-400 dark:text-white/40">
        {schedules.length === 0
          ? 'Scanned automatically every Sunday'
          : `Scheduled: ${schedules.map((s) => `${JOB_TYPE_LABELS[s.jobType] ?? s.jobType} (${s.cadence})`).join(' · ')}`}
      </p>
    </div>
  )
}
