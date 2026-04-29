import type { HubRecommendation, HubFormat } from '@/lib/services/pillarAnalysis/types';
import { InfoTooltip } from './InfoTooltip';

const FORMAT_LABELS: Record<HubFormat, string> = {
  'nest-under-programs': 'Nest under existing program pages',
  'hybrid': 'Hybrid (vertical → programs, horizontal → /resources/)',
  'rename-blog-to-resources': 'Rename /blog/ → /resources/ (preserves backlink equity)',
  'fresh-resources-hub': 'Build a fresh /resources/ hub',
  'fresh-career-guides-hub': 'Build a fresh /career-guides/ hub',
};

export function HubRecommendationCard({ hub }: { hub: HubRecommendation }) {
  return (
    <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6">
      <h2 className="font-display font-bold text-lg text-[#1c2d4a] dark:text-white mb-2 flex items-center">
        Hub Recommendation
        <InfoTooltip>
          Recommended structure for organizing pillars on this site. Options: nest cluster pages under existing program pages, build a fresh /resources/ or /career-guides/ hub, or rename the existing /blog/ folder. Computed from how well each cluster aligns with program pages and how horizontal vs. vertical the topic mix is. Alternates show how close the runner-up choices were.
        </InfoTooltip>
      </h2>
      <div className="font-display font-bold text-2xl text-[#1c2d4a] dark:text-white">
        {FORMAT_LABELS[hub.primary]}
      </div>
      {hub.reasoning.length > 0 && (
        <ul className="mt-3 list-disc pl-6 text-sm text-gray-700 dark:text-white/80 space-y-1">
          {hub.reasoning.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      {hub.alternates.length > 0 && (
        <div className="mt-4 pt-4 border-t dark:border-navy-border">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-white/60 mb-2">
            Alternates
          </div>
          <ul className="space-y-1 text-sm text-gray-600 dark:text-white/70">
            {hub.alternates.slice(0, 3).map((a, i) => (
              <li key={i} className="flex justify-between">
                <span>{FORMAT_LABELS[a.format]}</span>
                <span className="font-mono text-gray-400 dark:text-white/40">
                  −{a.scoreDelta.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
