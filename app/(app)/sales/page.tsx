import { listProspects } from '@/lib/services/prospects'
import { ProspectDashboard } from '@/components/sales/intake/ProspectDashboard'

export const dynamic = 'force-dynamic'

export default async function SalesIntakePage() {
  const prospects = await listProspects()
  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-heading font-bold text-navy dark:text-white">Prospect Scans</h1>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          Scan a prospect’s site and share a branded opportunity report. Full scans take a while — start it before the meeting.
        </p>
      </header>
      <ProspectDashboard initialProspects={prospects} />
    </div>
  )
}
