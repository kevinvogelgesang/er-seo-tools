import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { PublicSection } from '@/lib/viewbook/public-types'
import { loadViewbookPublicData } from '@/lib/viewbook/public-data'
import { ViewbookShell } from '@/components/viewbook/public/ViewbookShell'
import { WelcomeSection } from '@/components/viewbook/public/WelcomeSection'
import { MilestonesSection } from '@/components/viewbook/public/MilestonesSection'
import { DataSourceSection } from '@/components/viewbook/public/DataSourceSection'
import { BrandSection } from '@/components/viewbook/public/BrandSection'
import { WsIntroSection } from '@/components/viewbook/public/WsIntroSection'
import { AssessmentSection } from '@/components/viewbook/public/AssessmentSection'
import { StrategySection } from '@/components/viewbook/public/StrategySection'
import { MaterialsSection } from '@/components/viewbook/public/MaterialsSection'
import { KickoffNextSection } from '@/components/viewbook/public/KickoffNextSection'
import { PcIntroSection } from '@/components/viewbook/public/PcIntroSection'
import { PcSetupSection } from '@/components/viewbook/public/PcSetupSection'
import { PcInviteSection } from '@/components/viewbook/public/PcInviteSection'
import { PcThanksSection } from '@/components/viewbook/public/PcThanksSection'
import { getOperatorEmailForPublicPage } from '@/lib/viewbook/public-session'

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
  const [data, operatorEmail] = await Promise.all([
    loadViewbookPublicData(token),
    getOperatorEmailForPublicPage(),
  ])
  if (!data) notFound()

  const renderSection = (section: PublicSection): ReactNode => {
    const props = { section, data, token }
    switch (section.sectionKey) {
      case 'welcome':
        return <WelcomeSection {...props} />
      case 'milestones':
        return <MilestonesSection {...props} />
      case 'data-source':
        return <DataSourceSection {...props} />
      case 'brand':
        return <BrandSection {...props} />
      case 'assessment':
        return <AssessmentSection {...props} />
      case 'strategy':
        return <StrategySection {...props} />
      case 'materials':
        return <MaterialsSection {...props} />
      case 'kickoff-next':
        return <KickoffNextSection {...props} isOperator={operatorEmail != null} />
      case 'ws-intro':
        return <WsIntroSection {...props} />
      case 'pc-intro':
        return <PcIntroSection {...props} />
      case 'pc-setup':
        return <PcSetupSection {...props} />
      case 'pc-invite':
        return <PcInviteSection {...props} />
      case 'pc-thanks':
        return <PcThanksSection {...props} />
      default:
        return null
    }
  }

  return (
    <ViewbookShell
      token={token}
      data={data}
      primarySections={data.primarySections}
      carriedSections={data.carriedSections}
      renderSection={renderSection}
    />
  )
}
