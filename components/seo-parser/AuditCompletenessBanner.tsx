import type { Completeness } from '@/lib/types';

/**
 * Warns when the uploaded crawl is too thin to be a full SEO audit (verdict
 * 'thin' = no internal crawl; 'partial' = high share of issues with no URLs).
 * Renders nothing when complete. This is the app-side, post-parse guard — the
 * single loud warning; the handoff skill only echoes a brief scope caveat.
 */
export function AuditCompletenessBanner({ completeness }: { completeness?: Completeness }) {
  if (!completeness || completeness.verdict === 'complete') return null;

  const thin = completeness.verdict === 'thin';
  const tone = thin
    ? 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10'
    : 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10';
  const heading = thin
    ? 'Incomplete audit — internal crawl missing'
    : 'Partial audit data';

  return (
    <div className={`rounded-xl border p-5 flex items-start gap-3 ${tone}`} role="alert">
      <div className="text-xl leading-none mt-0.5" aria-hidden>⚠️</div>
      <div className="space-y-1.5">
        <p className="font-display font-bold text-sm text-[#1c2d4a] dark:text-white">{heading}</p>
        <p className="text-sm text-gray-700 dark:text-white/80 leading-relaxed">{completeness.message}</p>
        {completeness.missingInputs.length > 0 && (
          <p className="text-xs text-gray-600 dark:text-white/60">
            Add: {completeness.missingInputs.join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}
