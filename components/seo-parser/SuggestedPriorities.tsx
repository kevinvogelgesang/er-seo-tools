'use client';
import React from 'react';
import { IssuesResult } from '@/lib/types';
import { getPrioritySummary, ScoredIssue } from '@/lib/services/priority.service';

function Row({ issue }: { issue: ScoredIssue }) {
  const sev = { critical: 'text-red-600', warning: 'text-orange-500', notice: 'text-blue-600' }[issue.severity];
  return (
    <li className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 dark:border-navy-border last:border-0">
      <span className="text-sm text-[#1c2d4a] dark:text-white truncate">{issue.description || issue.type}</span>
      <span className="flex items-center gap-2 shrink-0">
        <span className={`text-xs font-semibold ${sev}`}>{issue.severity}</span>
        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-navy-light text-gray-600 dark:text-white/60">{issue.effort} effort</span>
        <span className="text-xs text-gray-400">{issue.count}</span>
      </span>
    </li>
  );
}

export function SuggestedPriorities({ issues }: { issues: IssuesResult }) {
  const summary = getPrioritySummary(issues);
  if (summary.total_issues === 0) return null;
  return (
    <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border border-gray-100 dark:border-navy-border p-6">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#1c2d4a] dark:text-white uppercase tracking-wide">Suggested Priorities</h3>
        <span className="text-xs text-gray-400 dark:text-white/40">Heuristic ranking of issue types — confirm against the Claude roadmap</span>
      </div>
      <ul>{summary.top_priorities.slice(0, 8).map((i, k) => <Row key={`${i.type}-${k}`} issue={i} />)}</ul>
    </div>
  );
}
