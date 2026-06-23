import type { Metadata } from 'next'
import { GenerateReportForm } from '@/components/reports/GenerateReportForm'
import { ReportLibrary } from '@/components/reports/ReportLibrary'

export const metadata: Metadata = {
  title: 'SEO Reports — ER SEO Tools',
}

export default function ReportsPage() {
  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="font-display font-extrabold text-2xl text-navy dark:text-white mb-1">SEO Reports</h1>
          <p className="text-sm font-body text-gray-500 dark:text-white/50">
            Generate branded GA4 + Search Console performance reports. Pick a client, date range, and comparison period.
          </p>
        </div>
        <GenerateReportForm />
        <div className="mt-8">
          <ReportLibrary />
        </div>
      </div>
    </div>
  )
}
