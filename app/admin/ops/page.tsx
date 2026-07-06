import type { Metadata } from 'next'
import { loadOpsSnapshot } from '@/lib/ops/ops-snapshot'
import { OpsView } from '@/components/admin/OpsView'

export const metadata: Metadata = { title: 'Ops — ER SEO Tools' }
export const dynamic = 'force-dynamic' // always live; never statically cached

export default async function OpsPage() {
  const snapshot = await loadOpsSnapshot()
  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="font-display font-extrabold text-2xl text-navy dark:text-white mb-1">Ops</h1>
          <p className="text-sm font-body text-gray-500 dark:text-white/50">
            Job queue, health signals, disk/DB footprint, and browser-pool state. Read-only.
          </p>
        </div>
        <OpsView snapshot={snapshot} />
      </div>
    </div>
  )
}
