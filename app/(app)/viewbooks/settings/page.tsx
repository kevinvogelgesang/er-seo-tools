import type { Metadata } from 'next'
import { TemplateEditor } from '@/components/viewbook/admin/templates/TemplateEditor'
import { StrategyDocsCard } from '@/components/viewbook/admin/StrategyDocsCard'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Onboarding Viewbook Templates' }

export default function ViewbookSettingsPage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-heading font-bold text-navy dark:text-white">Onboarding Viewbook templates</h1>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          The section template library — copy, content, and data-source fields, edited once and rendered into every
          viewbook (per-viewbook overrides live in each viewbook&apos;s editor).
        </p>
      </header>
      <StrategyDocsCard />
      <TemplateEditor />
    </div>
  )
}
