export function ArchivedSessionBanner() {
  return (
    <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-6 py-4">
      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Archived session</p>
      <p className="text-sm text-amber-700 dark:text-amber-200/80 mt-1">
        The full report data for this session was archived after 90 days. This view is rebuilt
        from the findings database — recommendations, keyword signals, duplicate-content detail,
        and performance data are unavailable.
      </p>
    </div>
  );
}
