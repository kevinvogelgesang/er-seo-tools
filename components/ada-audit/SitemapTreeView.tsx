'use client'

import { useState } from 'react'
import { Spinner } from '@/components/Spinner'
import type { SitePageResult, StoredAxeResults } from '@/lib/ada-audit/types'
import type { TreeNode } from './useSiteAuditPages'
import AuditIssueTabs from './AuditIssueTabs'
import { safeExternalHref } from '@/lib/safe-external-href'

// ─── Shared impact count (same as in SiteAuditResultsView) ──────────────────

function ImpactCount({ n, color }: { n: number; color: string }) {
  if (n === 0) return <span className="text-navy/40 dark:text-white/40">—</span>
  return <span className={`font-semibold ${color}`}>{n}</span>
}

// ─── Leaf page row (expandable, lazy-loads violations) ───────────────────────

function LeafPageRow({ page, depth }: { page: SitePageResult; depth: number }) {
  const [expanded, setExpanded] = useState(false)
  const [violations, setViolations] = useState<StoredAxeResults['violations'] | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleExpand() {
    if (expanded) { setExpanded(false); return }
    setExpanded(true)
    if (violations !== null) return
    setLoading(true)
    try {
      const res = await fetch(`/api/ada-audit/${page.adaAuditId}`)
      if (res.ok) {
        const data = await res.json()
        setViolations(data.results?.violations ?? [])
      }
    } catch { /* leave null */ } finally {
      setLoading(false)
    }
  }

  const sc = page.scorecard
  const pageHref = safeExternalHref(page.url)

  // Extract just the last path segment for display
  let label: string
  try {
    const pathname = new URL(page.url).pathname.replace(/\/+$/, '')
    const segments = pathname.split('/').filter(Boolean)
    label = segments.length > 0 ? segments[segments.length - 1] : '/ (homepage)'
  } catch {
    label = page.url
  }

  return (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        className={`w-full flex items-center border-b border-gray-100 dark:border-navy-border hover:bg-gray-50 dark:hover:bg-navy-light cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-orange/40 ${expanded ? 'bg-gray-50 dark:bg-navy-light' : ''}`}
        style={{ paddingLeft: `${depth * 20 + 16}px` }}
        onClick={handleExpand}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0 py-2.5 pr-3">
          <svg
            aria-hidden="true"
            className={`w-3 h-3 flex-shrink-0 text-navy/30 dark:text-white/30 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <svg aria-hidden="true" className="w-3.5 h-3.5 flex-shrink-0 text-navy/25 dark:text-white/25" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[12px] font-body text-navy/80 dark:text-white/80 truncate" title={page.url}>
              {label}
            </span>
            {pageHref && (
              <a
                href={pageHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${page.url} in new tab`}
                className="flex-shrink-0 text-navy/40 dark:text-white/30 hover:text-orange dark:hover:text-orange transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </div>
          {page.status === 'error' && (
            <span className="text-[10px] font-body bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400 px-2 py-0.5 rounded" title={page.error ?? ''}>
              error
            </span>
          )}
        </div>
        {page.status !== 'error' && sc && (
          <div className="flex items-center gap-0 flex-shrink-0">
            <span className="w-12 text-center text-[12px] font-body"><ImpactCount n={sc.critical} color="text-red-600" /></span>
            <span className="w-12 text-center text-[12px] font-body"><ImpactCount n={sc.serious} color="text-orange-600" /></span>
            <span className="w-12 text-center text-[12px] font-body"><ImpactCount n={sc.moderate} color="text-yellow-600" /></span>
            <span className="w-12 text-center text-[12px] font-body"><ImpactCount n={sc.minor} color="text-blue-600" /></span>
            <span className="w-12 text-center text-[12px] font-body font-semibold text-navy/70 dark:text-white/70">{sc.total}</span>
          </div>
        )}
      </button>
      {expanded && (
        <div className="bg-gray-50 dark:bg-navy-deep border-b border-gray-100 dark:border-navy-border" style={{ paddingLeft: `${depth * 20 + 40}px` }}>
          <div className="px-4 py-4">
            {loading ? (
              <div className="flex items-center gap-2 text-[12px] font-body text-navy/40 dark:text-white/40 py-2">
                <Spinner />
                Loading violations…
              </div>
            ) : page.status === 'error' ? (
              <p className="text-[12px] font-body text-red-600 dark:text-red-400 py-2">{page.error}</p>
            ) : violations !== null ? (
              <div className="space-y-3">
                <AuditIssueTabs violations={violations} />
                <a
                  href={`/ada-audit/${page.adaAuditId}`}
                  className="inline-block text-[12px] font-body font-semibold text-orange hover:text-orange-light transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  View full audit ↗
                </a>
              </div>
            ) : (
              <p className="text-[12px] font-body text-navy/40 dark:text-white/40 py-2">Could not load violations.</p>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ─── Folder node (collapsible, shows aggregate counts) ───────────────────────

function FolderNode({ node, depth }: { node: TreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1)
  const sc = node.aggregate

  return (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        className="w-full flex items-center border-b border-gray-100 dark:border-navy-border hover:bg-gray-50 dark:hover:bg-navy-light cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-orange/40"
        style={{ paddingLeft: `${depth * 20 + 16}px` }}
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0 py-2.5 pr-3">
          <svg
            aria-hidden="true"
            className={`w-3 h-3 flex-shrink-0 text-navy/30 dark:text-white/30 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <svg aria-hidden="true" className="w-3.5 h-3.5 flex-shrink-0 text-orange/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="text-[13px] font-body font-semibold text-navy/70 dark:text-white/70">
            /{node.segment}
          </span>
          <span className="text-[11px] font-body text-navy/30 dark:text-white/30">
            {node.descendantCount} page{node.descendantCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-0 flex-shrink-0">
          <span className="w-12 text-center text-[12px] font-body"><ImpactCount n={sc.critical} color="text-red-600" /></span>
          <span className="w-12 text-center text-[12px] font-body"><ImpactCount n={sc.serious} color="text-orange-600" /></span>
          <span className="w-12 text-center text-[12px] font-body"><ImpactCount n={sc.moderate} color="text-yellow-600" /></span>
          <span className="w-12 text-center text-[12px] font-body"><ImpactCount n={sc.minor} color="text-blue-600" /></span>
          <span className="w-12 text-center text-[12px] font-body font-semibold text-navy/70 dark:text-white/70">{sc.total}</span>
        </div>
      </button>
      {expanded && (
        <>
          {node.pages.map((page) => (
            <LeafPageRow key={page.adaAuditId} page={page} depth={depth + 1} />
          ))}
          {node.children.map((child) =>
            child.pages.length === 1 && child.children.length === 0 ? (
              <LeafPageRow key={child.fullPath} page={child.pages[0]} depth={depth + 1} />
            ) : (
              <FolderNode key={child.fullPath} node={child} depth={depth + 1} />
            )
          )}
        </>
      )}
    </>
  )
}

// ─── Main tree view ──────────────────────────────────────────────────────────

interface Props {
  root: TreeNode
}

export default function SitemapTreeView({ root }: Props) {
  if (root.descendantCount === 0 && root.pages.length === 0) {
    return (
      <div className="px-6 py-8 text-center text-[13px] font-body text-navy/40 dark:text-white/40">
        No pages match the current filters.
      </div>
    )
  }

  return (
    <div>
      {/* Column headers */}
      <div className="flex items-center border-b border-gray-100 dark:border-navy-border bg-gray-50/50 dark:bg-navy-deep/50 px-4 py-2">
        <span className="flex-1 text-[10px] font-body font-semibold uppercase tracking-wider text-navy/40 dark:text-white/40">
          Path
        </span>
        <div className="flex items-center gap-0 flex-shrink-0">
          <span className="w-12 text-center text-[10px] font-body font-semibold uppercase tracking-wider text-red-400">Crit</span>
          <span className="w-12 text-center text-[10px] font-body font-semibold uppercase tracking-wider text-orange-400">Ser</span>
          <span className="w-12 text-center text-[10px] font-body font-semibold uppercase tracking-wider text-yellow-500">Mod</span>
          <span className="w-12 text-center text-[10px] font-body font-semibold uppercase tracking-wider text-blue-400">Min</span>
          <span className="w-12 text-center text-[10px] font-body font-semibold uppercase tracking-wider text-navy/40 dark:text-white/40">Total</span>
        </div>
      </div>

      {/* Root pages (homepage) */}
      {root.pages.map((page) => (
        <LeafPageRow key={page.adaAuditId} page={page} depth={0} />
      ))}

      {/* Child folders and pages */}
      {root.children.map((child) =>
        child.pages.length === 1 && child.children.length === 0 ? (
          <LeafPageRow key={child.fullPath} page={child.pages[0]} depth={0} />
        ) : (
          <FolderNode key={child.fullPath} node={child} depth={0} />
        )
      )}
    </div>
  )
}
