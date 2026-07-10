import { CTA_CLOSING } from '@/lib/sales/copy'
import type { SalesReportData } from '@/lib/sales/sales-report-data'
import { HeroTiles } from './HeroTiles'
import { AccessibilitySalesSection, GeoSalesSection, PerformanceSalesSection, SeoSalesSection } from './sections'

export function SalesReportView(props: { data: SalesReportData; token: string; contactEmail: string }) {
  const { data } = props
  const scanned = data.completedAt ? new Date(data.completedAt).toLocaleDateString('en-US', { dateStyle: 'medium' }) : null
  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <header className="space-y-2">
          <p className="text-[12px] font-heading font-semibold uppercase tracking-wide text-navy/50 dark:text-white/50">
            Enrollment Resources · Website Opportunity Report
          </p>
          <h1 className="text-2xl font-heading font-bold text-navy dark:text-white">
            Prepared for <span className="text-blue-700 dark:text-blue-400">{data.prospect.name}</span>
          </h1>
          <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
            {data.prospect.domain}
            {scanned ? ` · scanned ${scanned}` : ''}
            {data.pagesTotal ? ` · ${data.pagesTotal} pages` : ''}
          </p>
        </header>
        <HeroTiles {...data.headline} />
        <AccessibilitySalesSection data={data.accessibility} token={props.token} archived={data.archived} />
        <SeoSalesSection data={data.seo} />
        <PerformanceSalesSection data={data.performance} />
        <GeoSalesSection data={data.geo} />
        <footer className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6 space-y-2">
          {data.preparedBy && (
            <p className="text-[13px] font-heading font-semibold text-navy dark:text-white">
              Prepared by {data.preparedBy} — Enrollment Resources
            </p>
          )}
          <p className="text-[13px] font-body text-navy/60 dark:text-white/60">{CTA_CLOSING}</p>
          <a href={`mailto:${props.contactEmail}`} className="inline-block text-[13px] font-heading font-semibold text-blue-700 dark:text-blue-400">
            {props.contactEmail}
          </a>
        </footer>
      </div>
    </div>
  )
}
