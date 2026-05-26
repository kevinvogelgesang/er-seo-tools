import { cookies } from 'next/headers'
import { OPERATOR_NAME_COOKIE_NAME, sanitizeOperatorName } from '@/lib/auth'
import { fetchAllRecents } from '@/lib/ada-audit/recents-query'
import RecentsTable from '@/components/ada-audit/RecentsTable'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Recents — ADA Audit' }

export default async function RecentsPage() {
  const operator = sanitizeOperatorName((await cookies()).get(OPERATOR_NAME_COOKIE_NAME)?.value)
  const items = await fetchAllRecents(100) // scope=all
  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="font-display font-bold text-[24px] text-navy dark:text-white mb-6">Recents</h1>
      <RecentsTable initialItems={items} initialScope="all" operator={operator} variant="full" />
    </main>
  )
}
