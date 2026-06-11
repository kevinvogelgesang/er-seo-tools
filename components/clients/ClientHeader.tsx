// components/clients/ClientHeader.tsx
//
// Dashboard header: name, domain chips, seed-URL count, Teamwork link,
// scheduled-scan line, Edit link. Read-only (Phase 1a) — editing lives at
// /clients/manage.

export interface ClientHeaderProps {
  name: string
  domains: string[]
  seedUrls: string[]
  teamworkTasklistId: string | null
  schedules: { jobType: string; cadence: string; nextRunAt: string }[]
}

export function ClientHeader({ name, domains, seedUrls, teamworkTasklistId, schedules }: ClientHeaderProps) {
  return (
    <div className="mb-8">
      <a href="/clients" className="text-xs text-gray-400 dark:text-white/40 hover:text-[#f5a623] transition-colors">
        ← Clients
      </a>
      <div className="flex flex-wrap items-center justify-between gap-3 mt-1">
        <h1 className="text-3xl font-display font-bold text-[#1c2d4a] dark:text-white">{name}</h1>
        <a
          href="/clients/manage"
          className="text-sm font-semibold text-[#f5a623] hover:text-[#e09415] transition-colors"
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
            className="text-xs font-semibold text-[#f5a623] hover:text-[#e09415]"
          >
            Teamwork ↗
          </a>
        )}
      </div>
      <p className="mt-1.5 text-xs text-gray-400 dark:text-white/40">
        {schedules.length === 0
          ? 'No scheduled scans'
          : `Scheduled: ${schedules.map((s) => `${s.jobType} (${s.cadence})`).join(' · ')}`}
      </p>
    </div>
  )
}
