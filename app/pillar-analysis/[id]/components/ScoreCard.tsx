import { InfoTooltip } from './InfoTooltip';

export function ScoreCard({
  score, dataCompleteness,
}: { score: number; dataCompleteness: number }) {
  const completenessPct = Math.round(dataCompleteness * 100);
  return (
    <div className="rounded-lg border bg-white dark:bg-navy-card dark:border-navy-border p-6">
      <div className="text-sm text-gray-500 dark:text-white/60 uppercase tracking-wide flex items-center">
        Site Fit Score
        <InfoTooltip>
          A 1–10 score for how worthwhile a pillar-page model is on this site. Combines six weighted signals — content volume, topical concentration, existing organic footprint, internal-link gap, program-page clarity, and backlink distribution. Tuned for higher-ed/career-college sites. The data completeness percentage shows how many of those six signals had real input data versus neutral defaults.
        </InfoTooltip>
      </div>
      <div className="flex items-baseline gap-3 mt-2">
        <div className="text-5xl font-bold text-gray-900 dark:text-white">{score}</div>
        <div className="text-2xl text-gray-400 dark:text-white/40">/ 10</div>
      </div>
      <div className={`mt-2 text-sm ${
        completenessPct < 50 ? 'text-amber-600 dark:text-amber-400'
          : completenessPct < 100 ? 'text-gray-600 dark:text-white/60'
          : 'text-emerald-600 dark:text-emerald-400'
      }`}>
        {completenessPct}% data completeness
      </div>
    </div>
  );
}
