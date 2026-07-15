import type { SalesReportData } from '@/lib/sales/sales-report-data'
import { HeroRow } from './HeroRow'
import { HeroTiles } from './HeroTiles'
import { InquiryForm } from './InquiryForm'
import { SalesReportHeader } from './SalesReportHeader'
import { AccessibilitySalesSection, GeoSalesSection, PerformanceSalesSection, SeoSalesSection } from './sections'

export function SalesReportView(props: { data: SalesReportData; token: string; contactEmail: string }) {
  const { data } = props
  const scanned = data.completedAt
    ? new Date(data.completedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })
    : null
  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
      <SalesReportHeader prospectName={data.prospect.name} domain={data.prospect.domain} preparedBy={data.preparedBy} />
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <p className="text-[12px] font-body text-navy/50 dark:text-white/50">
          {scanned ? `Scanned ${scanned}` : 'Scan date unavailable'}
          {data.pagesTotal ? ` · ${data.pagesTotal} pages` : ''}
        </p>
        <HeroRow
          token={props.token}
          auditId={data.auditId}
          domain={data.prospect.domain}
          overallScore={data.overallScore}
          heroScreenshot={data.heroScreenshot}
        />
        <HeroTiles {...data.headline} />
        <AccessibilitySalesSection data={data.accessibility} standardTested={data.standardTested} archived={data.archived} />
        <SeoSalesSection data={data.seo} pagesScanned={data.pagesTotal ?? 0} />
        <PerformanceSalesSection data={data.performance} />
        <GeoSalesSection data={data.geo} pagesTotal={data.pagesTotal} />
        <InquiryForm contactEmail={props.contactEmail} prospectName={data.prospect.name} domain={data.prospect.domain} />
      </div>
    </div>
  )
}
