import type {
  SubscoreBreakdown as SB,
  SubscorePresence,
} from '@/lib/services/pillarAnalysis/types';
import { InfoTooltip } from './InfoTooltip';

const LABELS: Record<keyof SB, string> = {
  contentVolume: 'Informational content volume',
  topicalConcentration: 'Topical concentration',
  organicFootprint: 'Existing organic footprint',
  internalLinkGap: 'Internal-link gap',
  programPageClarity: 'Program-page clarity',
  backlinkDistribution: 'Backlink distribution',
};

const TOOLTIPS: Record<keyof SB, React.ReactNode> = {
  contentVolume: (
    <>
      Count of informational pages (blog/news/resource) on the site. Score curve: 0 below 15 posts (too thin to support pillars), 10 at 100+ posts (deep enough to anchor multiple clusters). Linear in between.
    </>
  ),
  topicalConcentration: (
    <>
      Number of topic clusters of size ≥3 that emerge from anchor assignment. 5–8 clusters is the sweet spot (10/10). Fewer means the site doesn&apos;t have enough topical depth; more (≥14) gets penalized for fragmentation.
    </>
  ),
  organicFootprint: (
    <>
      Sum of GSC impressions across informational pages, log-scaled. Higher means the site already has latent search demand a pillar model could harvest. Requires GSC export to compute — shows N/A if absent.
    </>
  ),
  internalLinkGap: (
    <>
      Inverse of average internal inbound links to informational pages. <strong>High score = LOW current linking density = high pillar opportunity</strong> (pillaring would meaningfully add link equity). Low score = pages already well-cross-linked = pillaring adds less. Counterintuitive but it measures <em>opportunity</em>, not health.
    </>
  ),
  programPageClarity: (
    <>
      Mean intent-classification confidence on program pages. High = program pages clearly read as transactional/commercial (good — they can anchor pillars). Low = program pages are ambiguous (fix them first before pillaring).
    </>
  ),
  backlinkDistribution: (
    <>
      Coefficient of variation in referring-domain count across informational pages. Higher means uneven backlink distribution (some posts have many, most have none) — pillaring can consolidate that authority. Requires Semrush data — shows N/A if absent.
    </>
  ),
};

export function SubscoreBreakdown({
  subscores,
  subscorePresence,
}: {
  subscores: SB;
  subscorePresence?: SubscorePresence | null;
}) {
  return (
    <div className="rounded-lg border bg-white dark:bg-navy-card dark:border-navy-border p-6">
      <div className="text-sm text-gray-500 dark:text-white/60 uppercase tracking-wide mb-4 flex items-center">
        Subscore Breakdown
        <InfoTooltip>
          How each of the six site-fit signals contributed to the composite score. Bars show 0–10 values; N/A means that subscore&apos;s underlying data wasn&apos;t available in the input (e.g., no GSC or Semrush export). The composite score uses neutral 5.0 defaults internally for missing signals so one absence doesn&apos;t tank the score, but those defaults aren&apos;t shown here — only real measurements.
        </InfoTooltip>
      </div>
      <ul className="space-y-3">
        {(Object.keys(subscores) as Array<keyof SB>).map((k) => {
          // Backwards-compat: when presence map is null (older records pre-migration),
          // assume every subscore is present so we don't blanket-N/A historical data.
          const isPresent = subscorePresence ? subscorePresence[k] : true;
          return (
            <li key={k} className="flex items-center gap-3">
              <div
                className={`w-56 text-sm flex items-center ${
                  isPresent
                    ? 'text-gray-700 dark:text-white/80'
                    : 'text-gray-400 dark:text-white/40'
                }`}
              >
                <span>{LABELS[k]}</span>
                <InfoTooltip label={`About ${LABELS[k]}`}>{TOOLTIPS[k]}</InfoTooltip>
              </div>
              {isPresent ? (
                <>
                  <div className="flex-1 h-2 bg-gray-200 dark:bg-navy-border rounded">
                    <div
                      className="h-2 rounded bg-blue-500 dark:bg-blue-400"
                      style={{ width: `${subscores[k] * 10}%` }}
                    />
                  </div>
                  <div className="w-10 text-right font-mono text-sm text-gray-700 dark:text-white/80">
                    {subscores[k].toFixed(1)}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex-1" />
                  <div className="w-10 text-right font-mono text-sm text-gray-400 dark:text-white/40">
                    N/A
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
