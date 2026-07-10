import { notFound } from 'next/navigation'
import { loadSalesReportData } from '@/lib/sales/sales-report-data'
import { SalesReportView } from '@/components/sales/SalesReportView'

export const dynamic = 'force-dynamic'

export default async function SalesReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await loadSalesReportData(token)
  if (result.kind === 'invalid') notFound()

  if (result.kind === 'pending') {
    return (
      <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep flex items-center justify-center px-6">
        {/* Makes the "updates automatically" copy truthful: reloads until the
            audit becomes reportable (short verifier window). */}
        <meta httpEquiv="refresh" content="20" />
        <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-8 max-w-md text-center space-y-2">
          <h1 className="text-xl font-heading font-bold text-navy dark:text-white">Your report is being prepared</h1>
          <p className="text-[13px] font-body text-navy/60 dark:text-white/60">
            We’re still scanning {result.prospect.domain}. Check back shortly — this page updates automatically once the scan completes.
          </p>
        </div>
      </div>
    )
  }

  const contactEmail = process.env.SALES_CONTACT_EMAIL || 'kevin@enrollmentresources.com'
  return <SalesReportView data={result.data} token={token} contactEmail={contactEmail} />
}
