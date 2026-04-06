'use client'

import { useState } from 'react'
import AuditForm from './AuditForm'
import SiteAuditForm from './SiteAuditForm'
import AuditHistory from './AuditHistory'
import SiteAuditHistory from './SiteAuditHistory'

type Tab = 'single' | 'site'

export default function AuditIndexTabs() {
  const [tab, setTab] = useState<Tab>('single')

  return (
    <div className="space-y-8">
      {/* New audit card with tab toggle */}
      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
          <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-orange" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">New Audit</h2>

          {/* Tab toggle */}
          <div role="tablist" aria-label="Audit type" className="ml-auto flex items-center bg-gray-100 dark:bg-navy-light rounded-lg p-0.5 gap-0.5">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'single'}
              onClick={() => setTab('single')}
              className={`px-3 py-1.5 text-[12px] font-body font-semibold rounded-md transition-colors ${
                tab === 'single'
                  ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
                  : 'text-navy/50 dark:text-white/50 hover:text-navy dark:hover:text-white'
              }`}
            >
              Single Page
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'site'}
              onClick={() => setTab('site')}
              className={`px-3 py-1.5 text-[12px] font-body font-semibold rounded-md transition-colors ${
                tab === 'site'
                  ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
                  : 'text-navy/50 dark:text-white/50 hover:text-navy dark:hover:text-white'
              }`}
            >
              Full Site
            </button>
          </div>
        </div>
        <div className="p-6">
          {tab === 'single' ? <AuditForm /> : <SiteAuditForm />}
        </div>
      </div>

      {/* History tables */}
      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
          <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-orange" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">Recent Page Audits</h2>
        </div>
        <div className="p-6">
          <AuditHistory />
        </div>
      </div>

      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
          <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-orange" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
            </svg>
          </div>
          <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">Recent Site Audits</h2>
        </div>
        <div className="p-6">
          <SiteAuditHistory />
        </div>
      </div>
    </div>
  )
}
