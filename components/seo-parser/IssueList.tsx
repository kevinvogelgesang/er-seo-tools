'use client';

import { useState } from 'react';
import { Issue } from '@/lib/types';
import { SEVERITY_BADGE_COLORS } from '@/lib/constants/severity';

interface IssueListProps {
  issues: Issue[];
  severity: 'critical' | 'warning' | 'notice';
  onUrlClick?: (url: string) => void;
}

const severityColors = SEVERITY_BADGE_COLORS;

function IssueItem({
  issue,
  severity,
  onUrlClick,
}: {
  issue: Issue;
  severity: 'critical' | 'warning' | 'notice';
  onUrlClick?: (url: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasUrls = issue.urls && issue.urls.length > 0;
  const hasGroups = issue.groups && issue.groups.length > 0;

  return (
    <div className="border border-gray-200 dark:border-navy-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-navy-light transition-colors"
      >
        <div className="flex items-center space-x-3">
          <span className={`px-2 py-1 text-xs font-medium rounded ${severityColors[severity]}`}>
            {issue.count}
          </span>
          <span className="text-gray-900 dark:text-white font-medium text-sm text-left">
            {issue.type.replace(/_/g, ' ')}
          </span>
        </div>
        {(hasUrls || hasGroups) && (
          <svg
            className={`w-5 h-5 text-gray-400 dark:text-white/40 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {expanded && (
        <div className="px-4 py-3 bg-gray-50 dark:bg-navy-deep border-t border-gray-200 dark:border-navy-border">
          <p className="text-sm text-gray-600 dark:text-white/60 mb-3">{issue.description}</p>
          {hasUrls && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500 dark:text-white/50 uppercase">
                Affected URLs {issue.truncated && `(showing first ${issue.urls?.length})`}
              </p>
              <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
                {issue.urls?.map((url, i) => (
                  <li key={i} className="text-gray-600 dark:text-white/60 truncate">
                    {onUrlClick ? (
                      <button
                        type="button"
                        onClick={() => onUrlClick(url)}
                        className="hover:text-[#f5a623] text-left truncate max-w-full underline decoration-dotted underline-offset-2"
                        title={url}
                      >
                        {url}
                      </button>
                    ) : (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="hover:text-[#f5a623]">
                        {url}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasGroups && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500 dark:text-white/50 uppercase">Duplicate Groups</p>
              <ul className="text-sm space-y-2">
                {issue.groups?.map((group, i) => (
                  <li key={i} className="text-gray-600 dark:text-white/60">
                    <span className="font-medium">{group.count}x:</span>{' '}
                    <span className="italic">"{group.title || group.h1}"</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function IssueList({ issues, severity, onUrlClick }: IssueListProps) {
  if (issues.length === 0) {
    return <p className="text-gray-500 dark:text-white/50 text-center py-4 text-sm">No issues found</p>;
  }
  return (
    <div className="space-y-2">
      {issues.map((issue, i) => (
        <IssueItem
          key={`${issue.type}-${i}`}
          issue={issue}
          severity={severity}
          onUrlClick={onUrlClick}
        />
      ))}
    </div>
  );
}
