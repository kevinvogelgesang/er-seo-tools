'use client'

import { useState } from 'react'
import { SeoScanForm } from './SeoScanForm'
import { SeoUploadCard } from './SeoUploadCard'

type Tab = 'scan' | 'upload'

export function SeoAuditTabs({ notifyAvailable = false }: { notifyAvailable?: boolean }) {
  const [tab, setTab] = useState<Tab>('scan') // Scan default so inbound ?scan= lands on a mounted SeoScanForm
  return (
    <div className="space-y-6">
      {/* Segmented pill toggle — mirrors the ADA index (AuditIndexTabs) for cross-tool parity. */}
      <div role="tablist" aria-label="SEO audit type" className="inline-flex items-center bg-gray-100 dark:bg-navy-light rounded-lg p-0.5 gap-0.5">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'scan'}
          onClick={() => setTab('scan')}
          className={`px-3 py-1.5 text-[12px] font-body font-semibold rounded-md transition-colors ${
            tab === 'scan'
              ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
              : 'text-navy/60 dark:text-white/60 hover:text-navy dark:hover:text-white'
          }`}
        >
          Scan a URL
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'upload'}
          onClick={() => setTab('upload')}
          className={`px-3 py-1.5 text-[12px] font-body font-semibold rounded-md transition-colors ${
            tab === 'upload'
              ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
              : 'text-navy/60 dark:text-white/60 hover:text-navy dark:hover:text-white'
          }`}
        >
          Upload Screaming Frog CSVs
        </button>
      </div>
      {tab === 'scan' ? <SeoScanForm notifyAvailable={notifyAvailable} /> : <SeoUploadCard />}
    </div>
  )
}
