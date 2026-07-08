'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { CrawlDiff } from '@/lib/services/diff.service';
import { Issue } from '@/lib/types';

interface SessionRecord {
  id: string;
  kind?: 'session' | 'run';
  createdAt: string;
  status: string;
  files: string[];
}

function DeltaBadge({ value, inverse = false }: { value: number; inverse?: boolean }) {
  const isPositive = value > 0;
  const isGood = inverse ? !isPositive : isPositive;
  const color =
    value === 0
      ? 'text-gray-500 dark:text-white/50'
      : isGood
      ? 'text-green-600 dark:text-green-400'
      : 'text-red-600 dark:text-red-400';
  const prefix = value > 0 ? '+' : '';
  return (
    <span className={`font-semibold tabular-nums ${color}`}>
      {prefix}{value.toLocaleString()}
    </span>
  );
}

function SummaryDeltaCard({
  label,
  delta,
  inverse = false,
}: {
  label: string;
  delta: number;
  inverse?: boolean;
}) {
  const isPositive = delta > 0;
  const isGood = inverse ? !isPositive : isPositive;
  const border =
    delta === 0
      ? 'border-gray-100 dark:border-navy-border'
      : isGood
      ? 'border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10'
      : 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10';
  const prefix = delta > 0 ? '+' : '';
  const textColor =
    delta === 0
      ? 'text-gray-700 dark:text-white/70'
      : isGood
      ? 'text-green-700 dark:text-green-400'
      : 'text-red-700 dark:text-red-400';

  return (
    <div className={`rounded-lg border p-4 ${border}`}>
      <p className="text-xs text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-display font-extrabold ${textColor}`}>
        {prefix}{delta.toLocaleString()}
      </p>
    </div>
  );
}

function IssueList({
  issues,
  title,
  colorClass,
}: {
  issues: Issue[];
  title: string;
  colorClass: string;
}) {
  if (issues.length === 0) return null;
  return (
    <div className={`rounded-lg border p-5 ${colorClass}`}>
      <h3 className="font-semibold text-sm mb-3 uppercase tracking-wide">{title}</h3>
      <ul className="space-y-2">
        {issues.map((issue) => (
          <li key={issue.type} className="flex items-start justify-between gap-4 text-sm">
            <span className="font-medium">{issue.description}</span>
            <span className="font-bold tabular-nums flex-shrink-0">{issue.count.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function DiffPage() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [sessionAId, setSessionAId] = useState('');
  const [sessionBId, setSessionBId] = useState('');
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [diff, setDiff] = useState<CrawlDiff | null>(null);

  // Tracks whether an auto-run from query params is pending
  const autoRunPending = useRef(false);

  // Read ?a=&b= query params on mount and pre-select + auto-run
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const a = params.get('a')?.trim();
    const b = params.get('b')?.trim();
    if (a && b && a !== b) {
      setSessionAId(a);
      setSessionBId(b);
      autoRunPending.current = true;
    }
  }, []);

  // Auto-run the compare once both ids are set from query params
  useEffect(() => {
    if (autoRunPending.current && sessionAId && sessionBId && sessionAId !== sessionBId) {
      autoRunPending.current = false;
      void handleCompare();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionAId, sessionBId]);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await fetch('/api/parse/history');
        if (!res.ok) throw new Error('Failed to load history');
        const data = (await res.json()) as SessionRecord[];
        // Diff is SF-upload only (v1) — exclude live-scan CrawlRun entries
        setSessions(data.filter((s) => s.status === 'complete' && s.kind !== 'run'));
      } catch (err) {
        setHistoryError(err instanceof Error ? err.message : 'Failed to load history');
      } finally {
        setLoadingHistory(false);
      }
    }
    void fetchHistory();
  }, []);

  async function handleCompare() {
    if (!sessionAId || !sessionBId) return;
    setComparing(true);
    setCompareError(null);
    setDiff(null);

    try {
      const res = await fetch('/api/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionAId, sessionBId }),
      });
      const data = (await res.json()) as CrawlDiff & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Compare failed');
      setDiff(data);
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : 'Compare failed');
    } finally {
      setComparing(false);
    }
  }

  function labelForSession(s: SessionRecord): string {
    const date = formatDate(s.createdAt);
    const fileCount = s.files.length;
    return `${date} — ${fileCount} file${fileCount !== 1 ? 's' : ''}`;
  }

  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep py-12 px-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-white/50 mb-3">
            <Link href="/seo-audits" className="hover:text-[#1c2d4a] dark:hover:text-white transition-colors">
              SEO Parser
            </Link>
            <span>/</span>
            <span className="text-[#1c2d4a] dark:text-white">Compare Crawls</span>
          </div>
          <h1 className="font-display font-extrabold text-3xl text-[#1c2d4a] dark:text-white mb-2">
            Compare Crawls
          </h1>
          <p className="text-gray-600 dark:text-white/60 text-sm leading-relaxed">
            Select two completed analysis sessions to see what improved, regressed, or changed
            between crawls.
          </p>
        </div>

        {/* Session selector card */}
        <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6 mb-6">
          <h2 className="font-semibold text-[#1c2d4a] dark:text-white text-sm mb-5 uppercase tracking-wide">
            Select Sessions
          </h2>

          {loadingHistory && (
            <p className="text-sm text-gray-500 dark:text-white/50">Loading sessions&hellip;</p>
          )}
          {historyError && (
            <p className="text-sm text-red-600 dark:text-red-400">{historyError}</p>
          )}

          {!loadingHistory && sessions.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-white/50">
              No completed sessions found.{' '}
              <Link href="/seo-audits" className="text-[#f5a623] hover:underline">
                Run an analysis first.
              </Link>
            </p>
          )}

          {!loadingHistory && sessions.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-white/60 mb-1.5">
                  Session A (baseline)
                </label>
                <select
                  value={sessionAId}
                  onChange={(e) => setSessionAId(e.target.value)}
                  className="w-full border border-gray-200 dark:border-navy-border rounded-lg px-3 py-2.5 text-sm text-gray-800 dark:text-white/80 bg-white dark:bg-navy-card dark:text-white focus:outline-none focus:ring-2 focus:ring-[#f5a623] focus:border-transparent"
                >
                  <option value="">Select a session&hellip;</option>
                  {sessionAId && !sessions.find((s) => s.id === sessionAId) && (
                    <option key={sessionAId} value={sessionAId}>
                      Session {sessionAId.slice(0, 8)}&hellip;
                    </option>
                  )}
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {labelForSession(s)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-white/60 mb-1.5">
                  Session B (comparison)
                </label>
                <select
                  value={sessionBId}
                  onChange={(e) => setSessionBId(e.target.value)}
                  className="w-full border border-gray-200 dark:border-navy-border rounded-lg px-3 py-2.5 text-sm text-gray-800 dark:text-white/80 bg-white dark:bg-navy-card dark:text-white focus:outline-none focus:ring-2 focus:ring-[#f5a623] focus:border-transparent"
                >
                  <option value="">Select a session&hellip;</option>
                  {sessionBId && !sessions.find((s) => s.id === sessionBId) && (
                    <option key={sessionBId} value={sessionBId}>
                      Session {sessionBId.slice(0, 8)}&hellip;
                    </option>
                  )}
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {labelForSession(s)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {compareError && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg text-sm text-red-700 dark:text-red-400">
              {compareError}
            </div>
          )}

          <button
            onClick={handleCompare}
            disabled={comparing || !sessionAId || !sessionBId || sessionAId === sessionBId}
            className="bg-[#f5a623] text-[#1c2d4a] font-display font-bold text-sm px-6 py-3 rounded-lg hover:bg-[#e8971a] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {comparing ? 'Comparing\u2026' : 'Compare'}
          </button>
          {sessionAId === sessionBId && sessionAId !== '' && (
            <p className="mt-2 text-xs text-orange-600">Please select two different sessions.</p>
          )}
        </div>

        {/* Results */}
        {diff && (
          <div className="space-y-6">
            {/* Session labels */}
            <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-white/50">
              <span>
                <span className="font-semibold text-gray-700 dark:text-white/70">Session A:</span>{' '}
                {formatDate(diff.session_a.created_at)}
              </span>
              <span className="text-gray-300 dark:text-white/30">vs</span>
              <span>
                <span className="font-semibold text-gray-700 dark:text-white/70">Session B:</span>{' '}
                {formatDate(diff.session_b.created_at)}
              </span>
            </div>

            {/* Summary deltas */}
            <div>
              <h2 className="font-semibold text-[#1c2d4a] dark:text-white text-sm mb-3 uppercase tracking-wide">
                Summary Changes
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <SummaryDeltaCard label="Total URLs" delta={diff.summary.total_urls_delta} />
                <SummaryDeltaCard label="Indexable" delta={diff.summary.indexable_delta} />
                <SummaryDeltaCard label="OK (2xx)" delta={diff.summary.ok_responses_delta} />
                <SummaryDeltaCard
                  label="Client Errors"
                  delta={diff.summary.client_errors_delta}
                  inverse
                />
                <SummaryDeltaCard
                  label="Server Errors"
                  delta={diff.summary.server_errors_delta}
                  inverse
                />
                <SummaryDeltaCard label="Avg Word Count" delta={Math.round(diff.summary.avg_word_count_delta)} />
                {diff.summary.health_score_delta !== null && (
                  <SummaryDeltaCard
                    label="Health Score"
                    delta={diff.summary.health_score_delta}
                  />
                )}
              </div>
            </div>

            {/* Issue lists */}
            <div className="space-y-4">
              <h2 className="font-semibold text-[#1c2d4a] dark:text-white text-sm uppercase tracking-wide">
                Issue Changes
              </h2>
              {diff.new_issues.length === 0 &&
                diff.resolved_issues.length === 0 &&
                diff.worsened_issues.length === 0 &&
                diff.improved_issues.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-white/50 bg-white dark:bg-navy-card rounded-lg border border-gray-100 dark:border-navy-border p-5">
                    No issue changes detected between these two sessions.
                  </p>
                )}
              <IssueList
                issues={diff.new_issues}
                title="New Issues"
                colorClass="bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-800 dark:text-red-400"
              />
              <IssueList
                issues={diff.worsened_issues}
                title="Worsened Issues"
                colorClass="bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/30 text-orange-800 dark:text-orange-400"
              />
              <IssueList
                issues={diff.improved_issues}
                title="Improved Issues"
                colorClass="bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30 text-blue-800 dark:text-blue-400"
              />
              <IssueList
                issues={diff.resolved_issues}
                title="Resolved Issues"
                colorClass="bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30 text-green-800 dark:text-green-400"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
