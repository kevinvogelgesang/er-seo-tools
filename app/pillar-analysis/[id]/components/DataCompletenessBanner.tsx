export function DataCompletenessBanner({ completeness }: { completeness: number }) {
  const pct = Math.round(completeness * 100);
  return (
    <div className="rounded border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-400 p-4">
      <div className="font-display font-bold text-amber-800 dark:text-amber-300">
        Low-confidence score: only {pct}% of signals available
      </div>
      <div className="text-sm text-amber-700 dark:text-amber-200/80 mt-1">
        GSC and/or Semrush data are missing. Treat the score as directional only.
      </div>
    </div>
  );
}
