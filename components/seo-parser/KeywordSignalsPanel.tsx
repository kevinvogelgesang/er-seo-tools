'use client';

import React, { useState } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CompetingUrl {
  url: string;
  position: number;
  estimated_traffic: number;
}

interface CannibalizationAlert {
  keyword: string;
  search_volume: number;
  intent: string;
  competing_urls: CompetingUrl[];
}

interface OptimizationGap {
  url: string;
  title: string;
  h1: string;
  top_ranking_keywords: Array<{ keyword: string; position: number; search_volume: number }>;
}

interface QuickWin {
  keyword: string;
  position: number;
  search_volume: number;
  intent: string;
  url: string;
}

interface TopOrganicPage {
  url: string;
  estimated_monthly_traffic: number;
  keyword_count: number;
  traffic_share_pct: number;
  dominant_intent: string;
}

interface GapKeyword {
  keyword: string;
  volume: number;
  difficulty?: number;
  intent?: string;
}

export interface KeywordSignals {
  semrush_connected: boolean;
  gsc_connected: boolean;
  ga4_connected: boolean;
  total_ranking_keywords: number;
  keyword_cannibalization: CannibalizationAlert[];
  optimization_gaps: OptimizationGap[];
  quick_wins: QuickWin[];
  top_pages_by_organic_traffic: TopOrganicPage[];
  gap_keywords?: GapKeyword[];
}

interface KeywordSignalsPanelProps {
  data: KeywordSignals;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const intentColor = (intent: string) => {
  switch (intent.toLowerCase()) {
    case 'informational':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    case 'commercial':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
    case 'navigational':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
    case 'transactional':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  }
};

function fmt(n: number) {
  return n.toLocaleString();
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function CountBadge({ count }: { count: number }) {
  return (
    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-navy-deep text-gray-600 dark:text-white/60">
      {count}
    </span>
  );
}

function IntentBadge({ intent }: { intent: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${intentColor(intent)}`}
    >
      {intent}
    </span>
  );
}

function SubSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-navy-card rounded-lg border border-gray-100 dark:border-navy-border p-4">
      <h4 className="text-sm font-semibold text-[#1c2d4a] dark:text-white uppercase tracking-wide mb-3 flex items-center">
        {title}
        <CountBadge count={count} />
      </h4>
      {children}
    </div>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left text-xs font-semibold text-gray-500 dark:text-white/50 uppercase tracking-wide pb-2 pr-3 whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`py-2 pr-3 text-gray-700 dark:text-white/80 align-top ${className ?? ''}`}>
      {children}
    </td>
  );
}

// ─── Cannibalization Alerts ──────────────────────────────────────────────────

function CannibalizationTable({ rows }: { rows: CannibalizationAlert[] }) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-white/40">No cannibalization detected.</p>;
  }

  const sorted = [...rows].sort((a, b) => b.search_volume - a.search_volume);

  function toggleRow(idx: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th>Keyword</Th>
          <Th>Volume</Th>
          <Th>Intent</Th>
          <Th>Competing</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-navy-border">
        {sorted.map((row, idx) => {
          const expanded = expandedRows.has(idx);
          return (
            <React.Fragment key={idx}>
              <tr>
                <Td className="max-w-[180px]">
                  <span className="block truncate font-medium" title={row.keyword}>
                    {row.keyword}
                  </span>
                </Td>
                <Td className="whitespace-nowrap">{fmt(row.search_volume)}</Td>
                <Td>
                  <IntentBadge intent={row.intent} />
                </Td>
                <Td>
                  <button
                    type="button"
                    onClick={() => toggleRow(idx)}
                    className="text-xs text-[#1c2d4a] dark:text-white/60 underline decoration-dotted underline-offset-2 hover:text-[#f5a623] whitespace-nowrap"
                  >
                    {row.competing_urls.length} URL{row.competing_urls.length !== 1 ? 's' : ''}{' '}
                    {expanded ? '▲' : '▼'}
                  </button>
                </Td>
              </tr>
              {expanded && (
                <tr>
                  <td colSpan={4} className="pb-3 pt-0 pr-3">
                    <ul className="ml-2 space-y-1 border-l-2 border-gray-100 dark:border-navy-border pl-3">
                      {row.competing_urls.map((cu, ci) => (
                        <li key={ci} className="text-xs text-gray-600 dark:text-white/60">
                          <span className="inline-block w-8 font-semibold text-gray-400 dark:text-white/40">
                            #{cu.position}
                          </span>
                          <span className="truncate max-w-[280px] inline-block align-bottom" title={cu.url}>
                            {cu.url}
                          </span>
                          <span className="ml-2 text-gray-400 dark:text-white/40">
                            ~{fmt(cu.estimated_traffic)} visits
                          </span>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </Table>
  );
}

// ─── Quick Wins ──────────────────────────────────────────────────────────────

function QuickWinsTable({ rows }: { rows: QuickWin[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-white/40">No quick wins found.</p>;
  }

  const sorted = [...rows].sort((a, b) => b.search_volume - a.search_volume);

  return (
    <Table>
      <thead>
        <tr>
          <Th>Keyword</Th>
          <Th>Pos</Th>
          <Th>Volume</Th>
          <Th>Intent</Th>
          <Th>URL</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-navy-border">
        {sorted.map((row, idx) => (
          <tr key={idx}>
            <Td className="max-w-[160px]">
              <span className="block truncate font-medium" title={row.keyword}>
                {row.keyword}
              </span>
            </Td>
            <Td className="whitespace-nowrap">{row.position}</Td>
            <Td className="whitespace-nowrap">{fmt(row.search_volume)}</Td>
            <Td>
              <IntentBadge intent={row.intent} />
            </Td>
            <Td className="max-w-[160px]">
              <span className="block truncate text-xs text-gray-500 dark:text-white/50" title={row.url}>
                {row.url}
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// ─── Optimization Gaps ───────────────────────────────────────────────────────

function OptimizationGapsTable({ rows }: { rows: OptimizationGap[] }) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-white/40">No optimization gaps found.</p>;
  }

  // Sort by top keyword traffic desc (use first keyword's search_volume as proxy)
  const sorted = [...rows].sort((a, b) => {
    const aVol = a.top_ranking_keywords[0]?.search_volume ?? 0;
    const bVol = b.top_ranking_keywords[0]?.search_volume ?? 0;
    return bVol - aVol;
  });

  function toggleRow(idx: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th>Page URL</Th>
          <Th>Title / H1</Th>
          <Th>Keywords</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-navy-border">
        {sorted.map((row, idx) => {
          const expanded = expandedRows.has(idx);
          return (
            <React.Fragment key={idx}>
              <tr>
                <Td className="max-w-[180px]">
                  <span className="block truncate text-xs" title={row.url}>
                    {row.url}
                  </span>
                </Td>
                <Td className="max-w-[160px]">
                  <span className="block truncate text-xs font-medium" title={row.title}>
                    {row.title || row.h1 || '—'}
                  </span>
                </Td>
                <Td>
                  <button
                    type="button"
                    onClick={() => toggleRow(idx)}
                    className="text-xs text-[#1c2d4a] dark:text-white/60 underline decoration-dotted underline-offset-2 hover:text-[#f5a623] whitespace-nowrap"
                  >
                    {row.top_ranking_keywords.length} keyword{row.top_ranking_keywords.length !== 1 ? 's' : ''}{' '}
                    {expanded ? '▲' : '▼'}
                  </button>
                </Td>
              </tr>
              {expanded && (
                <tr>
                  <td colSpan={3} className="pb-3 pt-0 pr-3">
                    <ul className="ml-2 space-y-1 border-l-2 border-gray-100 dark:border-navy-border pl-3">
                      {row.top_ranking_keywords.map((kw, ki) => (
                        <li key={ki} className="text-xs text-gray-600 dark:text-white/60">
                          <span className="inline-block w-8 font-semibold text-gray-400 dark:text-white/40">
                            #{kw.position}
                          </span>
                          <span className="font-medium">{kw.keyword}</span>
                          <span className="ml-2 text-gray-400 dark:text-white/40">
                            {fmt(kw.search_volume)} vol
                          </span>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </Table>
  );
}

// ─── Top Organic Pages ───────────────────────────────────────────────────────

function TopOrganicPagesTable({ rows }: { rows: TopOrganicPage[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-white/40">No organic pages found.</p>;
  }

  const sorted = [...rows].sort((a, b) => b.estimated_monthly_traffic - a.estimated_monthly_traffic);

  return (
    <Table>
      <thead>
        <tr>
          <Th>URL</Th>
          <Th>Traffic</Th>
          <Th>Keywords</Th>
          <Th>Share</Th>
          <Th>Intent</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-navy-border">
        {sorted.map((row, idx) => (
          <tr key={idx}>
            <Td className="max-w-[180px]">
              <span className="block truncate text-xs" title={row.url}>
                {row.url}
              </span>
            </Td>
            <Td className="whitespace-nowrap">{fmt(row.estimated_monthly_traffic)}</Td>
            <Td className="whitespace-nowrap">{row.keyword_count}</Td>
            <Td className="whitespace-nowrap">{row.traffic_share_pct.toFixed(1)}%</Td>
            <Td>
              <IntentBadge intent={row.dominant_intent} />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// ─── Content Gap Keywords ────────────────────────────────────────────────────

function GapKeywordsTable({ rows }: { rows: GapKeyword[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-white/40">No content gap keywords found.</p>;
  }

  const sorted = [...rows].sort((a, b) => b.volume - a.volume);

  return (
    <Table>
      <thead>
        <tr>
          <Th>Keyword</Th>
          <Th>Volume</Th>
          <Th>Difficulty</Th>
          <Th>Intent</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-navy-border">
        {sorted.map((row, idx) => (
          <tr key={idx}>
            <Td className="max-w-[200px]">
              <span className="block truncate font-medium" title={row.keyword}>
                {row.keyword}
              </span>
            </Td>
            <Td className="whitespace-nowrap">{fmt(row.volume)}</Td>
            <Td className="whitespace-nowrap">
              {typeof row.difficulty === 'number' ? row.difficulty : '—'}
            </Td>
            <Td>{row.intent ? <IntentBadge intent={row.intent} /> : '—'}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function KeywordSignalsPanel({ data }: KeywordSignalsPanelProps) {
  const [expanded, setExpanded] = useState(true);

  // GSC-only notice — no SEMRush
  if (!data.semrush_connected) {
    if (data.gsc_connected) {
      return (
        <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border border-gray-100 dark:border-navy-border px-6 py-4">
          <p className="text-sm text-gray-400 dark:text-white/40">
            Connect SEMRush exports for keyword signals.
          </p>
        </div>
      );
    }
    return null;
  }

  const gapKeywords = data.gap_keywords ?? [];

  const totalItems =
    data.keyword_cannibalization.length +
    data.quick_wins.length +
    data.optimization_gaps.length +
    data.top_pages_by_organic_traffic.length +
    gapKeywords.length;

  return (
    <div className="bg-white dark:bg-navy-card rounded-lg shadow-sm border border-gray-100 dark:border-navy-border overflow-hidden">
      {/* Section header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-navy-light transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-[#1c2d4a] dark:text-white uppercase tracking-wide">
            Keyword Signals
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-navy-deep text-gray-600 dark:text-white/60">
            {fmt(data.total_ranking_keywords)} ranking keywords
          </span>
          {totalItems > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-navy-deep text-gray-600 dark:text-white/60">
              {totalItems} items
            </span>
          )}
        </div>
        <span className="text-gray-400 dark:text-white/40 text-base leading-none select-none">
          {expanded ? '▼' : '▶'}
        </span>
      </button>

      {expanded && (
        <div className="px-6 pb-6 border-t border-gray-100 dark:border-navy-border pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Cannibalization Alerts */}
            <SubSection title="Cannibalization Alerts" count={data.keyword_cannibalization.length}>
              <CannibalizationTable rows={data.keyword_cannibalization} />
            </SubSection>

            {/* Quick Wins */}
            <SubSection title="Quick Wins" count={data.quick_wins.length}>
              <QuickWinsTable rows={data.quick_wins} />
            </SubSection>

            {/* Optimization Gaps */}
            <SubSection title="Optimization Gaps" count={data.optimization_gaps.length}>
              <OptimizationGapsTable rows={data.optimization_gaps} />
            </SubSection>

            {/* Top Organic Pages */}
            <SubSection
              title="Top Organic Pages"
              count={data.top_pages_by_organic_traffic.length}
            >
              <TopOrganicPagesTable rows={data.top_pages_by_organic_traffic} />
            </SubSection>

            {/* Content Gap Keywords */}
            {gapKeywords.length > 0 && (
              <SubSection title="Content Gap Keywords" count={gapKeywords.length}>
                <GapKeywordsTable rows={gapKeywords} />
              </SubSection>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
