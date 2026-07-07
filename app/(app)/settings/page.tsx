import type { Metadata } from 'next'
import { ServiceAccountCard } from '@/components/settings/ServiceAccountCard'
import { ScheduleControls } from '@/components/settings/ScheduleControls'
import { ScoringWeightsCard } from '@/components/settings/ScoringWeightsCard'

export const metadata: Metadata = {
  title: 'Settings — ER SEO Tools',
}

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="font-display font-extrabold text-2xl text-navy dark:text-white mb-1">Settings</h1>
          <p className="text-sm font-body text-gray-500 dark:text-white/50">
            Google service-account connection status, monthly report schedule, and SEO scoring weights.
          </p>
          <p className="mt-2 text-sm font-body">
            <a href="/admin/ops" className="text-blue-600 dark:text-blue-400 hover:underline">Ops dashboard →</a>
          </p>
        </div>
        <ServiceAccountCard />
        <ScheduleControls />
        <ScoringWeightsCard />
      </div>
    </div>
  )
}
