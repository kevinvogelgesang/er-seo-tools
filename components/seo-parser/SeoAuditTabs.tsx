'use client'

import { useState } from 'react'
import { SeoScanForm } from './SeoScanForm'
import { SeoUploadCard } from './SeoUploadCard'

type Tab = 'scan' | 'upload'

export function SeoAuditTabs() {
  const [tab, setTab] = useState<Tab>('scan') // Scan default so inbound ?scan= lands on a mounted SeoScanForm
  return (
    <div className="space-y-6">
      <div className="flex gap-2" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'scan'}
          onClick={() => setTab('scan')}
          className={
            tab === 'scan'
              ? 'font-display font-bold text-navy dark:text-white border-b-2 border-orange px-3 py-2'
              : 'text-navy/60 dark:text-white/60 px-3 py-2'
          }
        >
          Scan a URL
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'upload'}
          onClick={() => setTab('upload')}
          className={
            tab === 'upload'
              ? 'font-display font-bold text-navy dark:text-white border-b-2 border-orange px-3 py-2'
              : 'text-navy/60 dark:text-white/60 px-3 py-2'
          }
        >
          Upload Screaming Frog CSVs
        </button>
      </div>
      {tab === 'scan' ? <SeoScanForm /> : <SeoUploadCard />}
    </div>
  )
}
