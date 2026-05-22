'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import AuditForm from './AuditForm'
import SiteAuditForm from './SiteAuditForm'
import ClientsAuditSummary from './ClientsAuditSummary'
import DashboardQueueStatus from './DashboardQueueStatus'
import MyRecentsCard from './MyRecentsCard'
import type { QueueStatusWithBatch } from '@/lib/ada-audit/types'
import type { RecentItem } from '@/lib/ada-audit/recents-query'

const QUEUE_POLL_INTERVAL_MS = 5000

type Tab = 'single' | 'site'

function parseTab(value: string | null): Tab {
  return value === 'site' ? 'site' : 'single'
}

interface Props {
  recentItems: RecentItem[]
  operator: string | null
}

export default function AuditIndexTabs({ recentItems, operator }: Props) {
  const searchParams = useSearchParams()

  // Initial tab derived from URL so SSR + first paint match. Infer 'site'
  // when ?prefillDomain= is present without an explicit ?auditTab= (a
  // prefill is only meaningful on the Full Site form).
  const [tab, setTab] = useState<Tab>(() => {
    const explicit = searchParams.get('auditTab')
    if (explicit) return parseTab(explicit)
    if (searchParams.get('prefillDomain')) return 'site'
    return 'single'
  })

  // Honor URL changes while the page is mounted (e.g., clicking a Clients
  // "Run audit" link from elsewhere on the same page). We only react to the
  // search params themselves changing — manual tab clicks call setTab directly.
  useEffect(() => {
    const explicit = searchParams.get('auditTab')
    if (explicit) setTab(parseTab(explicit))
    else if (searchParams.get('prefillDomain')) setTab('site')
  }, [searchParams])

  // Lifted queue poll — single 5s interval feeds DashboardQueueStatus,
  // SiteAuditForm (banner), and SiteAuditHistory (in-flight row merge).
  // Replaces the duplicate polls that used to live in SiteAuditForm and
  // SiteAuditHistory.
  const [queueStatus, setQueueStatus] = useState<QueueStatusWithBatch | null>(null)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch('/api/site-audit/queue')
        if (!res.ok) return
        const data = (await res.json()) as QueueStatusWithBatch
        if (!cancelled) setQueueStatus(data)
      } catch { /* swallow; cards hold last-known state */ }
    }
    void tick()
    const timer = setInterval(tick, QUEUE_POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

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
          {tab === 'single' ? <AuditForm /> : <SiteAuditForm queueStatus={queueStatus} />}
        </div>
      </div>

      {/* Queue status — Current Scan + Queue cards, between New Audit and Clients */}
      <DashboardQueueStatus queueStatus={queueStatus} />

      {/* Clients section */}
      <ClientsAuditSummary />

      {/* Operator-filtered recents — replaces full history tables on the dashboard */}
      <MyRecentsCard items={recentItems} operator={operator} />
    </div>
  )
}
