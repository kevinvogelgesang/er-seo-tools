import type { Metadata } from 'next'
import Link from 'next/link'
import { getClientFleet } from '@/lib/services/client-fleet'
import { FleetTable } from '@/components/clients/FleetTable'

export const dynamic = 'force-dynamic' // DB read per request; never prerender at build

export const metadata: Metadata = { title: 'Clients — ER SEO Tools' }

export default async function ClientsFleetPage() {
  const rows = await getClientFleet()
  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-display font-bold text-[#1c2d4a] dark:text-white">Clients</h1>
            <p className="text-sm text-gray-500 dark:text-white/60 mt-1">
              Latest scores and activity across every client.
            </p>
          </div>
          <Link
            href="/clients/manage"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1c2d4a] hover:bg-[#0f1d30] text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Add / manage clients →
          </Link>
        </div>
        <FleetTable rows={rows} />
      </div>
    </div>
  )
}
