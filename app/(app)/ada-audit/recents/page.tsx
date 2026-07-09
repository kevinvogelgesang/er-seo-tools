import { cookies } from 'next/headers'
import { AUTH_COOKIE_NAME, OPERATOR_NAME_COOKIE_NAME, getOperatorLabel } from '@/lib/auth'
import { fetchAllRecents } from '@/lib/ada-audit/recents-query'
import RecentsTable from '@/components/ada-audit/RecentsTable'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Recents — Audits' }

export default async function RecentsPage() {
  const c = await cookies()
  const operator = await getOperatorLabel(c.get(AUTH_COOKIE_NAME)?.value, c.get(OPERATOR_NAME_COOKIE_NAME)?.value)
  const { items, nextCursor } = await fetchAllRecents({ limit: 50 }) // scope=all, page one
  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="font-display font-bold text-[24px] text-navy dark:text-white mb-6">Recents</h1>
      <RecentsTable initialItems={items} initialNextCursor={nextCursor} initialScope="all" operator={operator} variant="full" />
    </main>
  )
}
