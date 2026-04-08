'use client';

import { useState } from 'react';
import { Issue } from '@/lib/types';
import { SEVERITY_BADGE_COLORS } from '@/lib/constants/severity';

interface IssueListProps {
  issues: Issue[];
  severity: 'critical' | 'warning' | 'notice';
  onUrlClick?: (url: string) => void;
}

const PAGE_SIZE = 50;

function formatIssueTitle(type: string): string {
  const stripped = type.startsWith('sf_') ? type.slice(3) : type;
  const spaced = stripped.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function ExternalLinkIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

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
  const [currentPage, setCurrentPage] = useState(0);

  const totalUrls = issue.urls?.length ?? 0;
  const totalPages = Math.ceil(totalUrls / PAGE_SIZE);
  const pagedUrls = issue.urls?.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE) ?? [];
  const hasGroups = issue.groups && issue.groups.length > 0;

  const urlRangeStart = currentPage * PAGE_SIZE + 1;
  const urlRangeEnd = Math.min((currentPage + 1) * PAGE_SIZE, totalUrls);

  return (
    <div className="border border-gray-200 dark:border-navy-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-navy-light transition-colors"
      >
        <div className="flex items-center space-x-3">
          <span className={`px-2 py-1 text-xs font-medium rounded ${SEVERITY_BADGE_COLORS[severity]}`}>
            {issue.count}
          </span>
          <span className="text-gray-900 dark:text-white font-medium text-sm text-left">
            {formatIssueTitle(issue.type)}
          </span>
        </div>
        <svg
          aria-hidden="true"
          className={`w-5 h-5 text-gray-400 dark:text-white/40 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 py-3 bg-gray-50 dark:bg-navy-deep border-t border-gray-200 dark:border-navy-border">
          {issue.description && (
            <p className="text-sm text-gray-600 dark:text-white/60 mb-3">{issue.description}</p>
          )}

          {totalUrls > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-500 dark:text-white/50 uppercase tracking-wide">
                  {totalUrls <= PAGE_SIZE
                    ? `Affected URLs — ${totalUrls} total`
                    : `Affected URLs — ${urlRangeStart}–${urlRangeEnd} of ${totalUrls} · export JSON for full list`}
                </p>
              </div>

              <ul className="text-sm space-y-1 max-h-64 overflow-y-auto">
                {pagedUrls.map((url, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-gray-600 dark:text-white/60 min-w-0">
                    {onUrlClick ? (
                      <button
                        type="button"
                        onClick={() => onUrlClick(url)}
                        className="hover:text-[#f5a623] text-left truncate flex-1 underline decoration-dotted underline-offset-2"
                        title={url}
                      >
                        {url}
                      </button>
                    ) : (
                      <span className="truncate flex-1" title={url}>{url}</span>
                    )}
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open in new tab"
                      className="flex-shrink-0 text-gray-400 dark:text-white/30 hover:text-[#f5a623] dark:hover:text-[#f5a623]"
                    >
                      <ExternalLinkIcon />
                    </a>
                  </li>
                ))}
              </ul>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-1 border-t border-gray-200 dark:border-navy-border">
                  <span className="text-xs text-gray-400 dark:text-white/40">
                    Page {currentPage + 1} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                      disabled={currentPage === 0}
                      className="text-xs px-3 py-1 rounded border border-gray-200 dark:border-navy-border text-gray-600 dark:text-white/60 disabled:opacity-40 disabled:cursor-not-allowed hover:border-[#f5a623] hover:text-[#f5a623] transition-colors"
                    >
                      ← Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={currentPage === totalPages - 1}
                      className="text-xs px-3 py-1 rounded border border-gray-200 dark:border-navy-border text-gray-600 dark:text-white/60 disabled:opacity-40 disabled:cursor-not-allowed hover:border-[#f5a623] hover:text-[#f5a623] transition-colors"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {hasGroups && (
            <div className="space-y-1 mt-2">
              <p className="text-xs font-medium text-gray-500 dark:text-white/50 uppercase tracking-wide">Duplicate Groups</p>
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
