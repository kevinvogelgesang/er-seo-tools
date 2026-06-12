'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { InstanceDiff, RuleInstanceDiff } from '@/lib/services/findings-shared'
import { ClientDate } from '@/components/ClientDate'

interface Props {
  diff: InstanceDiff
  previous: { siteAuditId: string | null; completedAt: string | null }
}

const SEV_PILL: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  notice: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60',
}

function RuleRow({ rule }: { rule: RuleInstanceDiff }) {
  const [open, setOpen] = useState(false)
  const isNewRule = rule.newTotal > 0 && rule.unchangedTotal === 0 && rule.resolvedTotal === 0
  return (
    <li className="py-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex flex-wrap items-center gap-2 text-left text-[12px] font-body">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${SEV_PILL[rule.severity]}`}>{rule.severity}</span>
        <span className="font-semibold text-navy dark:text-white">{rule.type}</span>
        {isNewRule && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-600 text-white">NEW</span>
        )}
        {rule.newTotal > 0 && <span className="text-red-600 dark:text-red-400">+{rule.newTotal} new{rule.regressedTotal > 0 ? ` (${rule.regressedTotal} regressed)` : ''}</span>}
        {rule.resolvedTotal > 0 && <span className="text-green-600 dark:text-green-400">−{rule.resolvedTotal} resolved</span>}
        {rule.unchangedTotal > 0 && <span className="text-navy/40 dark:text-white/40">{rule.unchangedTotal} unchanged</span>}
        <span className="ml-auto text-navy/30 dark:text-white/30">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-1.5 pl-2 space-y-1.5 text-[11px] font-body">
          {rule.newUrls.length > 0 && (
            <div>
              <span className="font-semibold text-red-600 dark:text-red-400">New on:</span>
              <ul className="mt-0.5 space-y-0.5">{rule.newUrls.map((u) => <li key={u} className="text-navy/60 dark:text-white/60 break-all">{u}</li>)}</ul>
              {rule.newTotal > rule.newUrls.length && <p className="text-navy/40 dark:text-white/40">…and {rule.newTotal - rule.newUrls.length} more</p>}
            </div>
          )}
          {rule.resolvedUrls.length > 0 && (
            <div>
              <span className="font-semibold text-green-600 dark:text-green-400">Resolved on:</span>
              <ul className="mt-0.5 space-y-0.5">{rule.resolvedUrls.map((u) => <li key={u} className="text-navy/60 dark:text-white/60 break-all">{u}</li>)}</ul>
              {rule.resolvedTotal > rule.resolvedUrls.length && <p className="text-navy/40 dark:text-white/40">…and {rule.resolvedTotal - rule.resolvedUrls.length} more</p>}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export default function SiteAuditDiffPanel({ diff, previous }: Props) {
  const noChanges = diff.newCount === 0 && diff.resolvedCount === 0
  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden shadow-sm">
      <div className="flex flex-wrap items-center gap-2 px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
        <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">Changes since previous audit</h2>
        {previous.completedAt && (
          <span className="text-[12px] font-body text-navy/40 dark:text-white/40">
            baseline <ClientDate iso={previous.completedAt} variant="dateTime" />
          </span>
        )}
        {previous.siteAuditId && (
          <Link href={`/ada-audit/site/${previous.siteAuditId}`} className="text-[12px] font-body text-orange hover:underline">
            view baseline →
          </Link>
        )}
      </div>
      <div className="p-6 space-y-4">
        <div className="flex flex-wrap gap-2 text-[12px] font-body font-semibold">
          <span className={`px-2 py-1 rounded-lg ${diff.newCount > 0 ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400' : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50'}`}>
            {diff.newCount} new{diff.newCount > 0 ? ` (${diff.regressedCount} regressed · ${diff.newPageCount} on new pages)` : ''}
          </span>
          <span className={`px-2 py-1 rounded-lg ${diff.resolvedCount > 0 ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50'}`}>
            {diff.resolvedCount} resolved
          </span>
          <span className="px-2 py-1 rounded-lg bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50">{diff.unchangedCount} unchanged</span>
          {diff.notRescannedCount > 0 && (
            <span className="px-2 py-1 rounded-lg bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50" title="Violations on pages that were not part of this crawl — neither new nor resolved.">
              {diff.notRescannedCount} not re-scanned
            </span>
          )}
        </div>
        {noChanges ? (
          <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
            No accessibility changes vs the previous audit{previous.completedAt ? <> of <ClientDate iso={previous.completedAt} variant="date" /></> : null}.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-navy-border">
            {diff.rules.map((r) => <RuleRow key={r.type} rule={r} />)}
          </ul>
        )}
      </div>
    </div>
  )
}
