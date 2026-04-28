'use client';
import { useState } from 'react';
import type { PillarTopic, UrlRecord } from '@/lib/services/pillarAnalysis/types';

export function PillarTopicList({
  topics, verdicts,
}: { topics: PillarTopic[]; verdicts: UrlRecord[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());

  if (topics.length === 0) {
    return (
      <div className="rounded-lg border bg-white dark:bg-navy-card dark:border-navy-border p-6 text-gray-600 dark:text-white/60">
        No pillar topics identified — clusters were too small or too sparse.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white dark:bg-navy-card dark:border-navy-border p-6">
      <div className="text-sm text-gray-500 dark:text-white/60 uppercase tracking-wide mb-4">
        Pillar Topics ({topics.length})
      </div>
      <ul className="space-y-3">
        {topics.map((t) => {
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
                  {cluster.map((r) => (
                    <li key={r.url} className="flex justify-between gap-3">
                      <a href={r.url} target="_blank" rel="noreferrer"
                         className="text-blue-600 dark:text-blue-400 truncate">
                        {r.url}
                      </a>
                      <span className="font-mono text-xs text-gray-500 dark:text-white/60">
                        {r.verdict}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
