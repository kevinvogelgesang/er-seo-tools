'use client';

import { useState } from 'react';
import { DuplicateContent } from '@/lib/types';

interface DuplicateContentSectionProps {
  data: DuplicateContent;
}

const PAGE_SIZE = 50;

// ─── Generic pagination controls ───────────────────────────────────────────

function Pagination({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 mt-3 text-sm text-gray-500 dark:text-white/50">
      <button
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        className="px-2 py-1 rounded border border-gray-200 dark:border-navy-border disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-navy-light transition-colors"
      >
        ‹ Prev
      </button>
      <span>
        Page {page + 1} of {pages}
      </span>
      <button
        disabled={page >= pages - 1}
        onClick={() => onPage(page + 1)}
        className="px-2 py-1 rounded border border-gray-200 dark:border-navy-border disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-navy-light transition-colors"
      >
        Next ›
      </button>
    </div>
  );
}

// ─── Count badge ────────────────────────────────────────────────────────────

function CountBadge({ count }: { count: number }) {
  return (
    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-navy-deep text-gray-600 dark:text-white/60">
      {count}
    </span>
  );
}

// ─── Sub-section wrapper ─────────────────────────────────────────────────────

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

// ─── Shared table wrapper ────────────────────────────────────────────────────

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

function IndexabilityBadge({ value }: { value: string }) {
  const isIndexable = value === 'Indexable';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        isIndexable
          ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400'
          : 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400'
      }`}
    >
      {value}
    </span>
  );
}

// ─── Exact Duplicates ────────────────────────────────────────────────────────

function ExactDuplicatesTable({
  rows,
}: {
  rows: DuplicateContent['exact_duplicates'];
}) {
  const [page, setPage] = useState(0);
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-white/40">None found.</p>;
  }
  const slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>Page URL</Th>
            <Th>Duplicate Of</Th>
            <Th>Similarity</Th>
            <Th>Indexability</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-navy-border">
          {slice.map((row, i) => (
            <tr key={i}>
              <Td className="max-w-[200px]">
                <span className="block truncate" title={row.address}>
                  {row.address}
                </span>
              </Td>
              <Td className="max-w-[200px]">
                <span className="block truncate" title={row.duplicate_of}>
                  {row.duplicate_of}
                </span>
              </Td>
              <Td className="whitespace-nowrap">{row.similarity_pct}%</Td>
              <Td>
                <IndexabilityBadge value={row.indexability} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={page} total={rows.length} onPage={setPage} />
    </>
  );
}

// ─── Near Duplicates ─────────────────────────────────────────────────────────

function NearDuplicatesTable({
  rows,
}: {
  rows: DuplicateContent['near_duplicates'];
}) {
  const [page, setPage] = useState(0);
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-white/40">None found.</p>;
  }
  const slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>Page URL</Th>
            <Th>Closest Match</Th>
            <Th>Near Dupe Count</Th>
            <Th>Indexability</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-navy-border">
          {slice.map((row, i) => (
            <tr key={i}>
              <Td className="max-w-[200px]">
                <span className="block truncate" title={row.address}>
                  {row.address}
                </span>
              </Td>
              <Td className="max-w-[200px]">
                <span className="block truncate" title={row.closest_match}>
                  {row.closest_match}
                </span>
              </Td>
              <Td className="whitespace-nowrap">{row.near_duplicate_count}</Td>
              <Td>
                <IndexabilityBadge value={row.indexability} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={page} total={rows.length} onPage={setPage} />
    </>
  );
}

// ─── Group table (titles / meta / h1s) ──────────────────────────────────────

type GroupRow = { value: string; affected_urls: string[]; affected_count: number };

function GroupTable({ rows }: { rows: GroupRow[] }) {
  const [page, setPage] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-white/40">None found.</p>;
  }

  const slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const globalIndex = (localIdx: number) => page * PAGE_SIZE + localIdx;

  function toggleRow(idx: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>Value</Th>
            <Th>Affected Pages</Th>
            <Th>URLs</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-navy-border">
          {slice.map((row, localIdx) => {
            const gi = globalIndex(localIdx);
            const expanded = expandedRows.has(gi);
            return (
              <tr key={gi}>
                <Td className="max-w-[220px]">
                  <span className="block truncate italic" title={row.value}>
                    &ldquo;{row.value}&rdquo;
                  </span>
                </Td>
                <Td className="whitespace-nowrap">{row.affected_count}</Td>
                <Td>
                  <button
                    type="button"
                    onClick={() => toggleRow(gi)}
                    className="text-xs text-[#1c2d4a] dark:text-white/60 underline decoration-dotted underline-offset-2 hover:text-[#f5a623]"
                  >
                    {expanded ? 'Hide' : 'Show'} URLs
                  </button>
                  {expanded && (
                    <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                      {row.affected_urls.map((url, ui) => (
                        <li key={ui} className="text-xs text-gray-600 dark:text-white/60 truncate" title={url}>
                          {url}
                        </li>
                      ))}
                    </ul>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Pagination page={page} total={rows.length} onPage={setPage} />
    </>
  );
}

// ─── Tabbed panel for titles / meta / h1s ───────────────────────────────────

type MetaTab = 'titles' | 'meta' | 'h1s';

function DuplicateMetaPanel({
  duplicate_titles,
  duplicate_meta_descriptions,
  duplicate_h1s,
  duplicate_titles_count,
  duplicate_meta_descriptions_count,
  duplicate_h1s_count,
}: Pick<
  DuplicateContent,
  | 'duplicate_titles'
  | 'duplicate_meta_descriptions'
  | 'duplicate_h1s'
  | 'duplicate_titles_count'
  | 'duplicate_meta_descriptions_count'
  | 'duplicate_h1s_count'
>) {
  const [activeTab, setActiveTab] = useState<MetaTab>('titles');
  const titleCount = duplicate_titles_count ?? duplicate_titles.length;
  const metaCount = duplicate_meta_descriptions_count ?? duplicate_meta_descriptions.length;
  const h1Count = duplicate_h1s_count ?? duplicate_h1s.length;

  const tabs: { key: MetaTab; label: string; count: number }[] = [
    { key: 'titles', label: 'Titles', count: titleCount },
    { key: 'meta', label: 'Meta Descriptions', count: metaCount },
    { key: 'h1s', label: 'H1s', count: h1Count },
  ];

  const titlesRows: GroupRow[] = duplicate_titles.map((r) => ({
    value: r.title,
    affected_urls: r.affected_urls,
    affected_count: r.count ?? r.affected_urls.length,
  }));
  const metaRows: GroupRow[] = duplicate_meta_descriptions.map((r) => ({
    value: r.meta_description,
    affected_urls: r.affected_urls,
    affected_count: r.count ?? r.affected_urls.length,
  }));
  const h1Rows: GroupRow[] = duplicate_h1s.map((r) => ({
    value: r.h1,
    affected_urls: r.affected_urls,
    affected_count: r.count ?? r.affected_urls.length,
  }));

  const totalCount = titleCount + metaCount + h1Count;

  return (
    <SubSection title="Duplicate Titles / Meta / H1s" count={totalCount}>
      {/* Tab bar */}
      <div className="flex gap-1 mb-3 border-b border-gray-100 dark:border-navy-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
              activeTab === tab.key
                ? 'bg-[#1c2d4a] dark:bg-navy-light text-white'
                : 'text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/70'
            }`}
          >
            {tab.label}
            <CountBadge count={tab.count} />
          </button>
        ))}
      </div>

      {activeTab === 'titles' && <GroupTable rows={titlesRows} />}
      {activeTab === 'meta' && <GroupTable rows={metaRows} />}
      {activeTab === 'h1s' && <GroupTable rows={h1Rows} />}
    </SubSection>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function DuplicateContentSection({ data }: DuplicateContentSectionProps) {
  const {
    exact_duplicates,
    near_duplicates,
    duplicate_titles,
    duplicate_meta_descriptions,
    duplicate_h1s,
    exact_duplicates_count,
    near_duplicates_count,
    duplicate_titles_count,
    duplicate_meta_descriptions_count,
    duplicate_h1s_count,
  } = data;

  const exactCount = exact_duplicates_count ?? exact_duplicates.length;
  const nearCount = near_duplicates_count ?? near_duplicates.length;
  const titleCount = duplicate_titles_count ?? duplicate_titles.length;
  const metaCount = duplicate_meta_descriptions_count ?? duplicate_meta_descriptions.length;
  const h1Count = duplicate_h1s_count ?? duplicate_h1s.length;
  const totalCount =
    exactCount +
    nearCount +
    titleCount +
    metaCount +
    h1Count;

  const defaultExpanded = totalCount >= 10;
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Don't render if nothing to show
  if (totalCount === 0) return null;

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
            Duplicate Content
          </span>
          <CountBadge count={totalCount} />
        </div>
        <span className="text-gray-400 dark:text-white/40 text-base leading-none select-none">
          {expanded ? '▼' : '▶'}
        </span>
      </button>

      {expanded && (
        <div className="px-6 pb-6 border-t border-gray-100 dark:border-navy-border pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Exact duplicates */}
            <SubSection title="Exact Duplicates" count={exactCount}>
              <ExactDuplicatesTable rows={exact_duplicates} />
            </SubSection>

            {/* Near duplicates */}
            <SubSection title="Near Duplicates" count={nearCount}>
              <NearDuplicatesTable rows={near_duplicates} />
            </SubSection>

            {/* Duplicate titles / meta / h1s — spans both columns */}
            <div className="lg:col-span-2">
              <DuplicateMetaPanel
                duplicate_titles={duplicate_titles}
                duplicate_meta_descriptions={duplicate_meta_descriptions}
                duplicate_h1s={duplicate_h1s}
                duplicate_titles_count={duplicate_titles_count}
                duplicate_meta_descriptions_count={duplicate_meta_descriptions_count}
                duplicate_h1s_count={duplicate_h1s_count}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
