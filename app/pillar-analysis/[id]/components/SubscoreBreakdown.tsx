import type { SubscoreBreakdown as SB } from '@/lib/services/pillarAnalysis/types';
import { InfoTooltip } from './InfoTooltip';

const LABELS: Record<keyof SB, string> = {
  contentVolume: 'Informational content volume',
  topicalConcentration: 'Topical concentration',
  organicFootprint: 'Existing organic footprint',
  internalLinkGap: 'Internal-link gap',
  programPageClarity: 'Program-page clarity',
  backlinkDistribution: 'Backlink distribution',
};

export function SubscoreBreakdown({ subscores }: { subscores: SB }) {
  return (
    <div className="rounded-lg border bg-white dark:bg-navy-card dark:border-navy-border p-6">
      <div className="text-sm text-gray-500 dark:text-white/60 uppercase tracking-wide mb-4 flex items-center">
        Subscore Breakdown
        <InfoTooltip>
          How each of the six site-fit signals contributed to the composite score. Bars show the 0–10 value of each subscore. A subscore at exactly 5 with no variation usually means the underlying data wasn't available (e.g., no Semrush export → backlink distribution defaults to 5).
        </InfoTooltip>
      </div>
      <ul className="space-y-3">
        {(Object.keys(subscores) as Array<keyof SB>).map((k) => (
          <li key={k} className="flex items-center gap-3">
            <div className="w-56 text-sm text-gray-700 dark:text-white/80">{LABELS[k]}</div>
            <div className="flex-1 h-2 bg-gray-200 dark:bg-navy-border rounded">
              <div
                className="h-2 rounded bg-blue-500 dark:bg-blue-400"
                style={{ width: `${subscores[k] * 10}%` }}
              />
            </div>
            <div className="w-10 text-right font-mono text-sm text-gray-700 dark:text-white/80">
              {subscores[k].toFixed(1)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
