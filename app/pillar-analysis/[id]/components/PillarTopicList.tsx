'use client';
import { useState } from 'react';
import type { PillarTopic, UrlRecord } from '@/lib/services/pillarAnalysis/types';
import { InfoTooltip } from './InfoTooltip';
import { safeExternalHref } from '@/lib/safe-external-href';

const CATEGORIES = [
  {
    key: 'program' as const,
    title: 'Program Pillars',
    tooltip:
      'Blog posts that cluster around your existing program pages. Each program page IS the pillar — the blogs link up to it as supporting cluster pages. This is the canonical higher-ed pillar model: the program page captures commercial intent, cluster pages capture informational queries that funnel toward enrollment. Note that these pillar names are based on the pages on each site, they may not appear as simple as "Cosmetology Program".',
    filter: (t: PillarTopic) => t.pillarPageType === 'program',
  },
  {
    key: 'location' as const,
    title: 'Location Pillars',
    tooltip:
      'Blog posts that cluster around individual location or campus pages. Each location becomes a regional pillar — useful when the school produces region-specific content (campus events, local job market, regional financial aid).',
    filter: (t: PillarTopic) => t.pillarPageType === 'location',
  },
  {
    key: 'catchall' as const,
    title: 'General Resources',
    tooltip:
      "Blog posts that don't cluster strongly around any specific program or location. These should live in a separate /resources/ or /career-guides/ hub rather than being forced under a program. Treat this section as the topical inventory for that future hub.",
    filter: (t: PillarTopic) => t.pillarPageType == null,
  },
];

export function PillarTopicList({
  topics, verdicts,
}: { topics: PillarTopic[]; verdicts: UrlRecord[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());

  if (topics.length === 0) {
    return (
      <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6 text-gray-600 dark:text-white/60">
        No pillar topics identified — clusters were too small or too sparse.
      </div>
    );
  }

  const renderTopic = (t: PillarTopic) => {
    const isOpen = open.has(t.clusterId);
    const cluster = verdicts.filter((r) => r.topicClusterId === t.clusterId);
    return (
      <li key={t.clusterId} className="border rounded dark:border-navy-border">
        <button
          onClick={() => {
            const next = new Set(open);
            next.has(t.clusterId) ? next.delete(t.clusterId) : next.add(t.clusterId);
            setOpen(next);
          }}
          className="w-full text-left px-4 py-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-navy-card/60"
        >
          <span className="font-semibold text-gray-900 dark:text-white">{t.name}</span>
          <span className="text-xs text-gray-500 dark:text-white/60">
            {cluster.length} pages • pillar: {t.pillarUrl ? '✓' : '—'}
          </span>
        </button>
        {isOpen && (
          <ul className="px-4 pb-3 space-y-1 text-sm">
            {cluster.map((r) => {
              const href = safeExternalHref(r.url);
              return (
                <li key={r.url} className="flex justify-between gap-3">
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer"
                       className="text-blue-600 dark:text-blue-400 truncate">
                      {r.url}
                    </a>
                  ) : (
                    <span className="truncate">{r.url}</span>
                  )}
                  <span className="font-mono text-xs text-gray-500 dark:text-white/60">
                    {r.verdict}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      {CATEGORIES.map((cat) => {
        const inCat = topics.filter(cat.filter);
        if (inCat.length === 0) return null;
        return (
          <div key={cat.key} className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6">
            <h2 className="font-display font-bold text-lg text-[#1c2d4a] dark:text-white mb-4 flex items-center">
              {cat.title} <span className="ml-2 text-sm font-normal text-gray-500 dark:text-white/60">({inCat.length})</span>
              <InfoTooltip>{cat.tooltip}</InfoTooltip>
            </h2>
            <ul className="space-y-3">
              {inCat.map(renderTopic)}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
