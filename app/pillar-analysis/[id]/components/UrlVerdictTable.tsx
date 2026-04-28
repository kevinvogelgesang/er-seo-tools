'use client';
import { useState, useMemo } from 'react';
import type { UrlRecord, Verdict } from '@/lib/services/pillarAnalysis/types';

const VERDICTS: Verdict[] = ['pillar', 'cluster', 'leave-as-blog', 'consolidate', 'prune', 'unclear'];

export function UrlVerdictTable({ verdicts }: { verdicts: UrlRecord[] }) {
  const [filter, setFilter] = useState<Verdict | 'all'>('all');
  const [sortBy, setSortBy] = useState<'wordCount' | 'inlinks' | 'gscClicks'>('inlinks');

  const filtered = useMemo(() => {
    let xs = verdicts;
    if (filter !== 'all') xs = xs.filter((r) => r.verdict === filter);
    return [...xs].sort((a, b) => (b[sortBy] ?? 0) - (a[sortBy] ?? 0));
  }, [verdicts, filter, sortBy]);

  return (
    <div className="rounded-lg border bg-white dark:bg-navy-card dark:border-navy-border p-6">
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-gray-500 dark:text-white/60 uppercase tracking-wide">
          URL Verdicts ({filtered.length} of {verdicts.length})
        </div>
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
          {filtered.slice(0, 200).map((r) => (
            <tr key={r.url} className="border-b dark:border-navy-border/50">
              <td className="py-2 truncate max-w-md">
                <a href={r.url} target="_blank" rel="noreferrer"
                   className="text-blue-600 dark:text-blue-400">{r.url}</a>
              </td>
              <td className="font-mono text-xs">{r.verdict}</td>
              <td className="text-right font-mono">{r.wordCount ?? '—'}</td>
              <td className="text-right font-mono">{r.inlinks ?? '—'}</td>
              <td className="text-right font-mono">{r.gscClicks ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 200 && (
        <p className="text-xs text-gray-500 dark:text-white/60 mt-3">
          Showing first 200 of {filtered.length}.
        </p>
      )}
    </div>
  );
}
