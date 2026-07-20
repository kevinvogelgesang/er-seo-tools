import type { Metadata } from 'next'
import { ViewbookIndex } from '@/components/viewbook/admin/ViewbookIndex'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Client Viewbooks' }

export default function ViewbooksPage() {
  return (
    // max-w-6xl (2026-07-19 table-formatting fix): the index table needs
    // ~980px of columns; the old max-w-5xl column left only ~976px, forcing
    // a permanent horizontal scrollbar that clipped the Actions column.
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-navy dark:text-white">Client Viewbooks</h1>
          <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
            Themed client hubs for website builds — data source, brand guidelines, milestones & strategy.
          </p>
        </div>
        <a href="/viewbooks/settings" className="text-sm text-teal-700 underline dark:text-teal-400">
          Company content →
        </a>
      </header>
      <ViewbookIndex />
    </div>
  )
}
