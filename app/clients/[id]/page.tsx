import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getClientDashboard } from '@/lib/services/client-dashboard'
import { getClientSeoHistory } from '@/lib/services/client-seo-history'
import { ClientHeader } from '@/components/clients/ClientHeader'
import { Scorecard } from '@/components/clients/Scorecard'
import { ActivityTimeline } from '@/components/clients/ActivityTimeline'
import { IssueTrendCard } from '@/components/clients/IssueTrendCard'

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const clientId = Number(id)
  if (!Number.isInteger(clientId) || clientId <= 0) return { title: 'Client — ER SEO Tools' }
  const data = await getClientDashboard(clientId)
  return { title: data.client ? `${data.client.name} — Client Dashboard` : 'Client — ER SEO Tools' }
}

export default async function ClientDashboardPage({ params }: Props) {
  const { id } = await params
  const clientId = Number(id)
  if (!Number.isInteger(clientId) || clientId <= 0) notFound()

  const [dash, history] = await Promise.all([
    getClientDashboard(clientId),
    getClientSeoHistory(clientId),
  ])
  if (!dash.client) notFound()

  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <ClientHeader
          name={dash.client.name}
          domains={dash.client.domains}
          seedUrls={dash.client.seedUrls}
          teamworkTasklistId={dash.client.teamworkTasklistId}
          schedules={dash.schedules}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <Scorecard
            label="SEO Health"
            score={dash.seo.series.latest}
            max={100}
            delta={dash.seo.series.delta}
            asOf={dash.seo.series.latestAt}
            href={dash.seo.latestHref}
            points={dash.seo.series.points}
          >
            {dash.seoCounts && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold tabular-nums">
                <span className="px-2 py-0.5 rounded bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400">
                  {dash.seoCounts.criticalCount} critical
                </span>
                <span className="px-2 py-0.5 rounded bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400">
                  {dash.seoCounts.warningCount} warnings
                </span>
                <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400">
                  {dash.seoCounts.noticeCount} notices
                </span>
              </div>
            )}
          </Scorecard>
          <Scorecard
            label="ADA"
            score={dash.ada.series.latest}
            max={100}
            delta={dash.ada.series.delta}
            asOf={dash.ada.series.latestAt}
            href={dash.ada.latestHref}
            points={dash.ada.series.points}
            sourceNote={dash.adaSource === 'page' ? 'page audits' : undefined}
          />
          <Scorecard
            label="Pillar"
            score={dash.pillar.series.latest}
            max={10}
            delta={dash.pillar.series.delta}
            asOf={dash.pillar.series.latestAt}
            href={dash.pillar.latestHref}
            points={dash.pillar.series.points}
          />
        </div>

        <div className="space-y-6">
          <IssueTrendCard sessions={history.sessions} latestTwo={history.latestTwo} />
          <div>
            <h2 className="text-sm font-semibold text-[#1c2d4a] dark:text-white uppercase tracking-wide mb-3">
              Activity
            </h2>
            <ActivityTimeline items={dash.timeline} />
          </div>
        </div>
      </div>
    </div>
  )
}
