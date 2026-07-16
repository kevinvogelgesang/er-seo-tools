import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { SectionKey } from '@/lib/viewbook/theme'
import { loadViewbookPublicData } from '@/lib/viewbook/public-data'
import { ViewbookShell } from '@/components/viewbook/public/ViewbookShell'
import { WelcomeSection } from '@/components/viewbook/public/WelcomeSection'
import { MilestonesSection } from '@/components/viewbook/public/MilestonesSection'
import { DataSourceSection } from '@/components/viewbook/public/DataSourceSection'
import { BrandSection } from '@/components/viewbook/public/BrandSection'
import { AssessmentPlaceholder } from '@/components/viewbook/public/AssessmentPlaceholder'
import { StrategySection } from '@/components/viewbook/public/StrategySection'
import { MaterialsSection } from '@/components/viewbook/public/MaterialsSection'

export const dynamic = 'force-dynamic'

// Token-linked page: never index, and never leak the token path via the
// Referer header on outbound requests (Google Fonts, review links) —
// Codex plan-fix 6.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function ViewbookPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const data = await loadViewbookPublicData(token)
  if (!data) notFound()

  const bySection = (sectionKey: SectionKey) => {
    const section = data.sections.find((s) => s.sectionKey === sectionKey)
    if (!section) return null
    const props = { section, data, token }
    switch (sectionKey) {
      case 'welcome':
        return <WelcomeSection {...props} />
      case 'milestones':
        return <MilestonesSection {...props} />
      case 'data-source':
        return <DataSourceSection {...props} />
      case 'brand':
        return <BrandSection {...props} />
      case 'assessment':
        // PR5 swaps this placeholder for the real AssessmentSection.
        return <AssessmentPlaceholder {...props} />
      case 'strategy':
        return <StrategySection {...props} />
      case 'materials':
        return <MaterialsSection {...props} />
    }
  }

  return <ViewbookShell token={token} data={data} sectionContent={bySection} />
}
