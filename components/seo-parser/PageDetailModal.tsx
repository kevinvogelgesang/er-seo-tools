'use client';

import { useEffect } from 'react';
import { AggregatedResult, Issue } from '@/lib/types';

interface PageDetailModalProps {
  url: string;
  result: AggregatedResult;
  onClose: () => void;
}

interface MatchedIssue {
  issue: Issue;
  severity: 'critical' | 'warning' | 'notice';
}

const severityBadgeColors: Record<'critical' | 'warning' | 'notice', string> = {
  critical: 'bg-red-100 text-red-800',
  warning: 'bg-yellow-100 text-yellow-800',
  notice: 'bg-blue-100 text-blue-800',
};

const severityOrder: Record<'critical' | 'warning' | 'notice', number> = {
  critical: 0,
  warning: 1,
  notice: 2,
};

function findIssuesForUrl(url: string, result: AggregatedResult): MatchedIssue[] {
  const matched: MatchedIssue[] = [];

  const checkIssue = (issue: Issue, severity: 'critical' | 'warning' | 'notice') => {
    const inUrls = issue.urls?.includes(url) ?? false;
    if (inUrls) {
      matched.push({ issue, severity });
    }
  };

  result.issues.critical.forEach((issue) => checkIssue(issue, 'critical'));
  result.issues.warnings.forEach((issue) => checkIssue(issue, 'warning'));
  result.issues.notices.forEach((issue) => checkIssue(issue, 'notice'));

  // Sort by severity order
  matched.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return matched;
}

export function PageDetailModal({ url, result, onClose }: PageDetailModalProps) {
  const matchedIssues = findIssuesForUrl(url, result);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Prevent body scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const truncatedUrl = url.length > 80 ? url.slice(0, 77) + '…' : url;

  const criticalMatches = matchedIssues.filter((m) => m.severity === 'critical');
  const warningMatches = matchedIssues.filter((m) => m.severity === 'warning');
  const noticeMatches = matchedIssues.filter((m) => m.severity === 'notice');

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      {/* Card — stop propagation so clicking inside does not close */}
      <div
        className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
              Page Details
            </p>
            <p
              className="font-mono text-sm text-[#1c2d4a] break-all"
              title={url}
            >
              {truncatedUrl}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors mt-0.5"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Issue count summary */}
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
          {matchedIssues.length === 0 ? (
            <p className="text-sm text-gray-500">No tracked issues found for this URL.</p>
          ) : (
            <p className="text-sm text-gray-700">
              <span className="font-semibold">{matchedIssues.length}</span>{' '}
              issue{matchedIssues.length !== 1 ? 's' : ''} affect this page
              {criticalMatches.length > 0 && (
                <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-800">
                  {criticalMatches.length} critical
                </span>
              )}
              {warningMatches.length > 0 && (
                <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800">
                  {warningMatches.length} warning{warningMatches.length !== 1 ? 's' : ''}
                </span>
              )}
              {noticeMatches.length > 0 && (
                <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800">
                  {noticeMatches.length} notice{noticeMatches.length !== 1 ? 's' : ''}
                </span>
              )}
            </p>
          )}
        </div>

        {/* Issue list — scrollable */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          {matchedIssues.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">
              This URL has no associated issues in the current report.
            </p>
          ) : (
            matchedIssues.map(({ issue, severity }, i) => (
              <div
                key={`${issue.type}-${i}`}
                className="border border-gray-200 rounded-lg p-4"
              >
                <div className="flex items-center gap-3 mb-2">
                  <span
                    className={`px-2 py-0.5 text-xs font-semibold rounded uppercase ${severityBadgeColors[severity]}`}
                  >
                    {severity}
                  </span>
                  <span className="text-sm font-medium text-gray-900">
                    {issue.type.replace(/_/g, ' ')}
                  </span>
                  <span className="ml-auto text-xs text-gray-400 flex-shrink-0">
                    {issue.count} affected
                  </span>
                </div>
                <p className="text-sm text-gray-600">{issue.description}</p>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#1c2d4a] text-white text-sm font-medium rounded-lg hover:bg-[#0f1d30] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
