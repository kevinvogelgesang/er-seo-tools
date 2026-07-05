/**
 * Amber "archived audit" banner shared by the single-page and site result
 * views. Copy differs by surface (verified against the two former inline
 * banners) so the exact strings are preserved per `variant`.
 */
export function ArchivedAuditBanner({ variant }: { variant: 'page' | 'site' }) {
  return (
    <div className="flex gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl text-[12px] font-body text-amber-800 dark:text-amber-400 leading-relaxed">
      <span>
        <strong>Archived audit:</strong>{' '}
        {variant === 'page'
          ? 'full detail (screenshots, complete code snippets, pass/incomplete lists) was pruned after 90 days. Violations shown are exact; node samples are capped at 5 per rule.'
          : 'full per-page detail was pruned after 90 days. Violations shown are exact; node samples are capped at 5 per rule.'}
      </span>
    </div>
  )
}
