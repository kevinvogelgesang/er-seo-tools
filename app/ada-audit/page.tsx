import { Suspense } from 'react'
import AuditIndexTabs from '@/components/ada-audit/AuditIndexTabs'

export const metadata = { title: 'ADA Audit — ER SEO Tools' }

export default function AdaAuditPage() {
  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="font-display font-bold text-[28px] text-navy dark:text-white">ADA / WCAG Audit</h1>
        <p className="text-[14px] font-body text-navy/60 dark:text-white/60 mt-1">
          Audit pages for accessibility violations using axe-core. Results are saved and shared across the team.
        </p>
      </div>
      <Suspense>
        <AuditIndexTabs />
      </Suspense>
    </main>
  )
}
