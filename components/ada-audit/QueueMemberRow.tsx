'use client'

import Link from 'next/link'
import type { AuditBatchMember } from '@/lib/ada-audit/types'

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  pending: 'Pending',
  running: 'Running',
  'pdfs-running': 'Scanning PDFs',
  complete: 'Complete',
  error: 'Error',
}

const STATUS_COLOR: Record<string, string> = {
  queued: 'bg-gray-100 dark:bg-gray-500/15 text-gray-700 dark:text-gray-300',
  pending: 'bg-gray-100 dark:bg-gray-500/15 text-gray-700 dark:text-gray-300',
  running: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400',
  'pdfs-running': 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400',
  complete: 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400',
  error: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400',
}

export default function QueueMemberRow({ member }: { member: AuditBatchMember }) {
  return (
    <tr className="border-b border-gray-50 dark:border-navy-border/50 hover:bg-gray-50/50 dark:hover:bg-navy-deep/30">
      <td className="px-6 py-3 font-body text-[13px] text-navy dark:text-white">
        <Link href={`/ada-audit/site/${member.id}`} className="hover:text-orange">
          {member.domain}
        </Link>
      </td>
      <td className="px-6 py-3 font-body text-[12px] text-navy/60 dark:text-white/60">
        {member.clientName ?? '—'}
      </td>
      <td className="px-6 py-3">
        <span className={`text-[11px] font-body font-semibold px-2 py-0.5 rounded ${STATUS_COLOR[member.status] ?? STATUS_COLOR.queued}`}>
          {STATUS_LABEL[member.status] ?? member.status}
        </span>
      </td>
      <td className="px-6 py-3 font-body text-[12px] text-navy/60 dark:text-white/60">
        {member.pagesComplete}/{member.pagesTotal}
        {member.pagesError > 0 ? ` (${member.pagesError} errored)` : ''}
      </td>
      <td className="px-6 py-3 font-body text-[12px] text-navy dark:text-white">
        {member.score ?? '—'}
      </td>
    </tr>
  )
}
