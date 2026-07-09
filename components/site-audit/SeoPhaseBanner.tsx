import type { SeoPhase } from '@/lib/ada-audit/seo-phase'

export function SeoPhaseBanner({ phase, live = false }: { phase: SeoPhase; live?: boolean }) {
  if (phase.state === 'done') return null

  const isActive = phase.state === 'running' || phase.state === 'queued'
  const title =
    phase.state === 'running' ? 'SEO analysis running'
    : phase.state === 'queued' ? 'SEO analysis queued'
    : phase.state === 'failed' ? 'SEO analysis failed'
    : 'SEO analysis not available'
  const body =
    phase.state === 'running' ? (phase.message ?? 'Checking links…')
    : phase.state === 'queued' ? 'Waiting to start…'
    : phase.state === 'failed' ? 'The SEO analysis did not complete. Re-run the audit to try again.'
    : 'This audit has no SEO analysis (it may predate the feature or the analysis was never completed).'

  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <div className="flex items-center gap-2 mb-2">
        <span className={
          phase.state === 'failed'
            ? 'inline-block w-2.5 h-2.5 rounded-full bg-red-500'
            : isActive
              ? 'inline-block w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse'
              : 'inline-block w-2.5 h-2.5 rounded-full bg-slate-400'
        } />
        <h2 className="font-display font-bold text-[15px] text-navy dark:text-white">{title}</h2>
      </div>
      <p className="text-[13px] font-body text-navy/60 dark:text-white/60">{body}</p>
      {phase.state === 'running' && phase.progress != null && (
        <div className="mt-3 h-2 w-full rounded-full bg-gray-100 dark:bg-navy-deep overflow-hidden">
          <div className="h-full rounded-full bg-orange transition-all" style={{ width: `${phase.progress}%` }} />
        </div>
      )}
      {isActive && (
        <p className="mt-3 text-[12px] font-body text-navy/40 dark:text-white/40">
          {live
            ? 'This updates automatically — results will open when they’re ready.'
            : 'This runs after the audit completes. Refresh this page to see the latest status.'}
        </p>
      )}
    </section>
  )
}
