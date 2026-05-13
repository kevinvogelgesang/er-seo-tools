'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import QueueActiveView from './QueueActiveView'
import QueueHistoryView from './QueueHistoryView'

type Tab = 'active' | 'history'

function parseTab(value: string | null): Tab {
  return value === 'history' ? 'history' : 'active'
}

export default function QueuePageTabs() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const tab = parseTab(searchParams.get('tab'))

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'active') params.delete('tab')
    else params.set('tab', next)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Queue view" className="inline-flex items-center bg-gray-100 dark:bg-navy-light rounded-lg p-0.5 gap-0.5">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'active'}
          onClick={() => setTab('active')}
          className={`px-3 py-1.5 text-[12px] font-body font-semibold rounded-md transition-colors ${
            tab === 'active'
              ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
              : 'text-navy/50 dark:text-white/50 hover:text-navy dark:hover:text-white'
          }`}
        >
          Active
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          onClick={() => setTab('history')}
          className={`px-3 py-1.5 text-[12px] font-body font-semibold rounded-md transition-colors ${
            tab === 'history'
              ? 'bg-white dark:bg-navy-card text-navy dark:text-white shadow-sm'
              : 'text-navy/50 dark:text-white/50 hover:text-navy dark:hover:text-white'
          }`}
        >
          History
        </button>
      </div>

      {tab === 'active' ? <QueueActiveView /> : <QueueHistoryView />}
    </div>
  )
}
