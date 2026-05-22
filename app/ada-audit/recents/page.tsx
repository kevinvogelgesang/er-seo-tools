import Link from 'next/link'
import { cookies } from 'next/headers'
import { OPERATOR_NAME_COOKIE_NAME, sanitizeOperatorName } from '@/lib/auth'
import { fetchRecentsForOperator } from '@/lib/ada-audit/recents-query'
import { formatDuration, formatDurationHover } from '@/lib/ada-audit/duration'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'My recents — ADA Audit' }

export default async function RecentsPage() {
  const operator = sanitizeOperatorName((await cookies()).get(OPERATOR_NAME_COOKIE_NAME)?.value)

  if (!operator) {
    return (
      <main className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="font-display font-bold text-[24px] text-navy dark:text-white mb-4">My recents</h1>
        <p className="text-[13px] font-body text-navy/60 dark:text-white/60">
          Set your operator name on the{' '}
          <Link href="/ada-audit" className="text-orange hover:underline">audit dashboard</Link>{' '}
          to see your recent audits.
        </p>
      </main>
    )
  }

  const items = await fetchRecentsForOperator(operator)

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="font-display font-bold text-[24px] text-navy dark:text-white mb-6">My recents</h1>
      {items.length === 0 ? (
        <p className="text-[13px] font-body text-navy/60 dark:text-white/60">No recents yet.</p>
      ) : (
        <table className="w-full text-[13px] font-body">
          <thead>
            <tr className="border-b border-gray-200 dark:border-navy-border">
              <th className="pb-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Type</th>
              <th className="pb-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">URL / Domain</th>
              <th className="pb-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Client</th>
              <th className="pb-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Status</th>
              <th className="pb-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Score</th>
              <th className="pb-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Duration</th>
              <th className="pb-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Date</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const href = it.type === 'page' ? `/ada-audit/${it.id}` : `/ada-audit/site/${it.id}`
              const label = it.type === 'page' ? it.url : it.domain
              return (
                <tr key={`${it.type}-${it.id}`} className="border-b border-gray-100 dark:border-navy-border">
                  <td className="py-2.5 pr-4">
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${it.type === 'page' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300'}`}>
                      {it.type === 'page' ? 'Page' : 'Site'}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 max-w-[280px] truncate">
                    <Link href={href} className="text-orange hover:underline">{label}</Link>
                  </td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.clientName ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.status}</td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.score ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-navy/40 dark:text-white/40 whitespace-nowrap" title={formatDurationHover(it.startedAt, it.completedAt) ?? ''}>
                    {formatDuration(it.startedAt, it.completedAt) ?? '—'}
                  </td>
                  <td className="py-2.5 pr-4 text-navy/40 dark:text-white/40 whitespace-nowrap">
                    {it.createdAt.toLocaleDateString()}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </main>
  )
}
