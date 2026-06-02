'use client';
import React from 'react';
import { Recommendation } from '@/lib/types';

const SEV_TEXT = { critical: 'text-red-600', warning: 'text-orange-500', notice: 'text-blue-600' } as const;

function humanize(issueType: string): string {
  const s = issueType.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Row({ rec }: { rec: Recommendation }) {
  const isSample = rec.affectedUrlComplete === false || (rec.affectedUrlSource && rec.affectedUrlSource !== 'derived-page-index');
  return (
    <li className="py-3 border-b border-gray-100 dark:border-navy-border last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-[#1c2d4a] dark:text-white truncate">{humanize(rec.issueType)}</span>
        <span className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-semibold ${SEV_TEXT[rec.severity]}`}>{rec.severity}</span>
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-navy-light text-gray-600 dark:text-white/60">{rec.effort} effort</span>
          <span className="text-xs text-gray-400">
            {rec.affectedUrlCount} page{rec.affectedUrlCount === 1 ? '' : 's'}
            {isSample && <span className="text-gray-400 dark:text-white/30"> (sample)</span>}
          </span>
        </span>
      </div>
      <p className="text-sm text-gray-600 dark:text-white/60 mt-1">{rec.fixGuidance}</p>
    </li>
  );
}

export function RecommendationsPanel({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) return null;
  return (
    <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border border-gray-100 dark:border-navy-border p-6">
      <h2 className="text-base font-semibold text-[#1c2d4a] dark:text-white mb-3">Recommendations</h2>
      <ul>
        {recommendations.map((rec, k) => (
          <Row key={`${rec.issueType}-${k}`} rec={rec} />
        ))}
      </ul>
    </div>
  );
}
