import type { Metadata } from 'next'
import { GenerateReportForm } from '@/components/reports/GenerateReportForm'
import { ReportLibrary } from '@/components/reports/ReportLibrary'
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'

export const metadata: Metadata = {
  title: 'SEO Reports — ER SEO Tools',
}

export default function ReportsPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="font-display font-extrabold text-2xl text-navy dark:text-white mb-1">SEO Reports</h1>
        <Explainer label="What is this?" className="mt-1">
          <ExplainerSummary>
            Generate branded GA4 + Search Console performance reports. Pick a client, date range,
            and comparison period. Data comes from the Google connection configured in Settings;
            each report snapshots its metrics at generation time, and finished PDFs collect in the
            library below.
          </ExplainerSummary>
        </Explainer>
      </div>
      <GenerateReportForm />
      <div className="mt-8">
        <ReportLibrary />
      </div>
    </div>
  )
}
