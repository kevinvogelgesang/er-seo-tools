import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { AUTH_COOKIE_NAME, OPERATOR_NAME_COOKIE_NAME, getOperatorLabel, getAuthSession } from '@/lib/auth'
import { fetchAllRecents } from '@/lib/ada-audit/recents-query'
import AuditIndexTabs from '@/components/ada-audit/AuditIndexTabs'

export const metadata = { title: 'ADA Audit — ER SEO Tools' }
export const dynamic = 'force-dynamic'

export default async function AdaAuditPage() {
  const c = await cookies()
  const authCookie = c.get(AUTH_COOKIE_NAME)?.value
  const operator = await getOperatorLabel(authCookie, c.get(OPERATOR_NAME_COOKIE_NAME)?.value)
  const initialScope = operator ? 'mine' : 'all'
  const recentItems = await fetchAllRecents(10, operator ?? undefined)
  // D7: only offer the notify checkbox when a verified session email exists.
  const notifyAvailable = Boolean((await getAuthSession(authCookie))?.email)

  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="font-display font-bold text-[28px] text-navy dark:text-white">ADA / WCAG Audit</h1>
        <p className="text-[14px] font-body text-navy/60 dark:text-white/60 mt-1">
          Audit pages for accessibility violations using axe-core. Results are saved and shared across the team.
        </p>
      </div>
      <Suspense>
        <AuditIndexTabs recentItems={recentItems} operator={operator} initialScope={initialScope} notifyAvailable={notifyAvailable} />
      </Suspense>
    </main>
  )
}
