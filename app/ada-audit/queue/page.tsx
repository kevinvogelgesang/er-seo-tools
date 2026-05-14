// app/ada-audit/queue/page.tsx
import QueuePageTabs from '@/components/ada-audit/QueuePageTabs'

export const dynamic = 'force-dynamic'

export default function QueuePage() {
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="font-display font-bold text-2xl text-navy dark:text-white">Audit Queue</h1>
        <p className="text-[13px] font-body text-navy/60 dark:text-white/60 mt-1">
          Monitor the current batch and review past ones.
        </p>
      </header>
      <QueuePageTabs />
    </div>
  )
}
