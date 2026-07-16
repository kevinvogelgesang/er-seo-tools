import type { Metadata } from 'next'
import { GlobalContentEditor } from '@/components/viewbook/admin/GlobalContentEditor'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Viewbook Company Content' }

export default function ViewbookSettingsPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-heading font-bold text-navy dark:text-white">Viewbook company content</h1>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          Team, process, and base SEO/GEO/E-E-A-T strategy — edited once, rendered into every viewbook.
        </p>
      </header>
      <GlobalContentEditor />
    </div>
  )
}
