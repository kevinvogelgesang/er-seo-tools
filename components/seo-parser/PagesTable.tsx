'use client';

import { useEffect, useState } from 'react';

interface PageRow {
  url: string;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  wordCount: number | null;
  crawlDepth: number | null;
  indexable: boolean;
  issueTypes: string[];
  issueCount: number;
}

interface PagesTableProps {
  sessionId: string;
  issueTypeOptions: string[];
  onUrlClick: (url: string) => void;
}

const PAGE_SIZE = 50;

type SortOption = 'issues' | 'wordCount' | 'crawlDepth';

const SORT_LABELS: Record<SortOption, string> = {
  issues: 'Most issues',
  wordCount: 'Fewest words',
  crawlDepth: 'Deepest',
};

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-left text-xs font-semibold text-gray-500 dark:text-white/50 uppercase tracking-wide pb-2 pr-3 whitespace-nowrap ${className ?? ''}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`py-2 pr-3 text-gray-700 dark:text-white/80 align-top ${className ?? ''}`}>
      {children}
    </td>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 dark:bg-navy-deep text-gray-600 dark:text-white/60">
      {children}
    </span>
  );
}

export function PagesTable({ sessionId, issueTypeOptions, onUrlClick }: PagesTableProps) {
  const [offset, setOffset] = useState(0);
  const [issueType, setIssueType] = useState('');
  const [sort, setSort] = useState<SortOption>('issues');
  const [pages, setPages] = useState<PageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs =
      `limit=${PAGE_SIZE}&offset=${offset}` +
      (issueType ? `&issueType=${encodeURIComponent(issueType)}` : '') +
      `&sort=${sort}`;
    fetch(`/api/seo-parser/${sessionId}/pages?${qs}`)
      .then((res) => res.json())
      .then((data: { pages: PageRow[]; total: number }) => {
        if (cancelled) return;
        setPages(Array.isArray(data.pages) ? data.pages : []);
        setTotal(typeof data.total === 'number' ? data.total : 0);
      })
      .catch(() => {
        if (cancelled) return;
        setPages([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, offset, issueType, sort]);

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + PAGE_SIZE, total);
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <div>
      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={issueType}
          onChange={(e) => {
            setIssueType(e.target.value);
            setOffset(0);
          }}
          className="text-sm rounded-lg border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-deep text-gray-700 dark:text-white/80 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1c2d4a]/30"
        >
          <option value="">All issue types</option>
          {issueTypeOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt.replace(/_/g, ' ')}
            </option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as SortOption);
            setOffset(0);
          }}
          className="text-sm rounded-lg border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-deep text-gray-700 dark:text-white/80 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#1c2d4a]/30"
        >
          {(Object.keys(SORT_LABELS) as SortOption[]).map((opt) => (
            <option key={opt} value={opt}>
              {SORT_LABELS[opt]}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-white/50 whitespace-nowrap">
            {rangeStart}–{rangeEnd} of {total}
          </span>
          <button
            type="button"
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            disabled={!canPrev}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-navy-border text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-navy-light transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            disabled={!canNext}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-navy-border text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-navy-light transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <p className="text-sm text-gray-400 dark:text-white/40 py-8 text-center">Loading…</p>
      ) : total === 0 ? (
        <p className="text-sm text-gray-400 dark:text-white/40 py-8 text-center">
          No crawled-page data for this session — re-run the analysis with an internal_all.csv to
          populate per-page detail.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>URL</Th>
                <Th>Indexable</Th>
                <Th>Words</Th>
                <Th>Depth</Th>
                <Th>Issues</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-navy-border">
              {pages.map((p) => {
                const shownChips = p.issueTypes.slice(0, 3);
                const extra = p.issueTypes.length - shownChips.length;
                return (
                  <tr key={p.url}>
                    <Td className="max-w-[320px]">
                      <button
                        type="button"
                        onClick={() => onUrlClick(p.url)}
                        title={p.url}
                        className="block truncate text-left font-mono text-xs text-[#1c2d4a] dark:text-white/80 underline decoration-dotted underline-offset-2 hover:text-[#f5a623]"
                      >
                        {p.url}
                      </button>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {p.indexable ? (
                        <span className="text-green-600 dark:text-green-400" aria-label="indexable">
                          ✓
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-white/40" aria-label="not indexable">
                          ✗
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{p.wordCount ?? '—'}</Td>
                    <Td className="whitespace-nowrap">{p.crawlDepth ?? '—'}</Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-gray-700 dark:text-white/80">
                          {p.issueCount}
                        </span>
                        {shownChips.map((t) => (
                          <Chip key={t}>{t.replace(/_/g, ' ')}</Chip>
                        ))}
                        {extra > 0 && <Chip>+{extra}</Chip>}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
