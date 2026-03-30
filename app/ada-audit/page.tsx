import { Suspense } from 'react'
import AuditForm from '@/components/ada-audit/AuditForm'
import AuditHistory from '@/components/ada-audit/AuditHistory'

export const metadata = { title: 'ADA Audit — ER SEO Tools' }

export default function AdaAuditPage() {
  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="font-display font-bold text-[28px] text-navy">ADA / WCAG Audit</h1>
        <p className="text-[14px] font-body text-navy/60 mt-1">
          Audit a page for accessibility violations using axe-core. Results are saved and shared across the team.
        </p>
      </div>

      {/* Audit form */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center">
            <svg className="w-4 h-4 text-orange" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h2 className="font-display font-bold text-[17px] text-navy">New Audit</h2>
        </div>
        <div className="p-6">
          <Suspense>
            <AuditForm />
          </Suspense>
        </div>
      </div>

      {/* History */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center">
            <svg className="w-4 h-4 text-orange" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h2 className="font-display font-bold text-[17px] text-navy">Recent Audits</h2>
        </div>
        <div className="p-6">
          <AuditHistory />
        </div>
      </div>
    </main>
  )
}
