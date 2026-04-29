'use client';
import { useState, useMemo, useEffect } from 'react';
import type { UrlRecord, Verdict } from '@/lib/services/pillarAnalysis/types';
import { InfoTooltip } from './InfoTooltip';

const VERDICTS: Verdict[] = ['pillar', 'cluster', 'leave-as-blog', 'consolidate', 'prune', 'unclear'];
const PAGE_SIZE = 25;

const VERDICT_COLORS: Record<Verdict, string> = {
  pillar: 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400',
  cluster: 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400',
  'leave-as-blog': 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-white/60',
  consolidate: 'bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400',
  prune: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
  unclear: 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50',
};

export function UrlVerdictTable({ verdicts }: { verdicts: UrlRecord[] }) {
  const [filter, setFilter] = useState<Verdict | 'all'>('all');
  const [sortBy, setSortBy] = useState<'wordCount' | 'inlinks' | 'gscClicks'>('inlinks');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let xs = verdicts;
    if (filter !== 'all') xs = xs.filter((r) => r.verdict === filter);
    return [...xs].sort((a, b) => (b[sortBy] ?? 0) - (a[sortBy] ?? 0));
  }, [verdicts, filter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // Reset to page 1 whenever filter or sort changes; clamp if total pages shrinks.
  useEffect(() => {
    setPage(1);
  }, [filter, sortBy]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const startIdx = (page - 1) * PAGE_SIZE;
  const endIdx = Math.min(startIdx + PAGE_SIZE, filtered.length);
  const visible = filtered.slice(startIdx, endIdx);

  return (
    <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-display font-bold text-lg text-[#1c2d4a] dark:text-white flex items-center">
          URL Verdicts ({filtered.length} of {verdicts.length})
          <InfoTooltip>
            Per-URL recommendation. Verdicts: pillar (anchor of a cluster — typically a program or location page), cluster (supports a pillar — link it to the recommended pillar), leave-as-blog (informational but doesn&apos;t fit a cluster — keep as-is), consolidate (merge into another similar page), prune (low value — noindex or 410). Each verdict has a confidence value visible in the underlying record.
          </InfoTooltip>
        </h2>
        <div className="flex gap-3">
          <select value={filter} onChange={(e) => setFilter(e.target.value as Verdict | 'all')}
            className="text-sm border rounded px-2 py-1 dark:bg-navy-card dark:border-navy-border dark:text-white">
            <option value="all">All verdicts</option>
            {VERDICTS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'wordCount' | 'inlinks' | 'gscClicks')}
            className="text-sm border rounded px-2 py-1 dark:bg-navy-card dark:border-navy-border dark:text-white">
            <option value="inlinks">Sort: inlinks</option>
            <option value="wordCount">Sort: word count</option>
            <option value="gscClicks">Sort: GSC clicks</option>
          </select>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-gray-500 dark:text-white/60 border-b dark:border-navy-border">
          <tr>
            <th className="text-left py-2">URL</th>
            <th className="text-left">Verdict</th>
            <th className="text-right">Words</th>
            <th className="text-right">Inlinks</th>
            <th className="text-right">GSC clicks</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.url} className="border-b dark:border-navy-border/50">
              <td className="py-2 truncate max-w-md">
                <a href={r.url} target="_blank" rel="noreferrer"
                   className="text-blue-600 dark:text-blue-400">{r.url}</a>
              </td>
              <td>
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${VERDICT_COLORS[r.verdict]}`}>
                  {r.verdict}
                </span>
              </td>
              <td className="text-right font-mono">{r.wordCount ?? '—'}</td>
              <td className="text-right font-mono">{r.inlinks ?? '—'}</td>
              <td className="text-right font-mono">{r.gscClicks ?? '—'}</td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-gray-500 dark:text-white/60">
                No URLs match this filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Pagination controls */}
      <div className="flex items-center justify-between mt-4 text-sm">
        <div className="text-gray-500 dark:text-white/60">
          {filtered.length === 0
            ? 'No rows'
            : `Showing rows ${startIdx + 1}–${endIdx} of ${filtered.length}`}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 rounded border dark:border-navy-border text-gray-700 dark:text-white/80 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-navy-card/60"
          >
            Prev
          </button>
          <span className="text-gray-600 dark:text-white/70">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1 rounded border dark:border-navy-border text-gray-700 dark:text-white/80 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-navy-card/60"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
