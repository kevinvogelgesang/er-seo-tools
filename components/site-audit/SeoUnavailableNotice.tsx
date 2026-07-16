// components/site-audit/SeoUnavailableNotice.tsx
// Rendered INSTEAD OF the whole SEO section stack when the audit's only
// seo-parser run is the exhausted-verifier placeholder (spec §3.3).
export default function SeoUnavailableNotice() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
      <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">SEO analysis unavailable</h3>
      <p className="mt-1 text-[13px] font-body text-amber-700 dark:text-amber-400/90">
        The post-scan SEO verifier did not complete for this audit, so broken-link,
        on-page, and content analysis are unavailable. Accessibility results are
        unaffected. Re-run the audit to populate this tab.
      </p>
    </div>
  )
}
