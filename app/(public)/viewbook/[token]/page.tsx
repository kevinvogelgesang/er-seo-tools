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
import { loadOperatorViewbookData } from '@/lib/viewbook/operator-data'
import { OperatorViewbookLayer, OperatorSectionWrapper } from '@/components/viewbook/public/OperatorLayer'

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

  const baseRenderSection = (section: PublicSection): ReactNode => {
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

  // Anonymous branch: the existing public shell, byte-shape unchanged — no
  // operator loader call, no presentation provider/bar/wrapper, and no operator
  // email or operator read model serialized into the payload (PR8 spec §10/§12).
  if (operatorEmail == null) {
    return (
      <ViewbookShell
        token={token}
        data={data}
        primarySections={data.primarySections}
        carriedSections={data.carriedSections}
        renderSection={baseRenderSection}
      />
    )
  }

  // Operator branch: only a VERIFIED-email session reaches the SELECT-only
  // operator read model, which wraps every section (incl. PR5's pc-*) without
  // editing any section component.
  const operatorData = await loadOperatorViewbookData(data.viewbookId)
  if (!operatorData) notFound()

  // Compose the wrapped section tree SERVER-SIDE (P1 fix): each section node is
  // rendered by the base switch, then wrapped in the OperatorSectionWrapper
  // client island with SERIALIZABLE props + the section node as CHILDREN — the
  // canonical Next pattern (server renders a client component). The resulting
  // ViewbookShell tree is a ReactNode passed as `children` to the client
  // layer, so NO closures ever cross the RSC boundary.
  const wrappedRenderSection = (section: PublicSection): ReactNode => {
    const operatorSection = operatorData.sections.find((item) => item.sectionKey === section.sectionKey)
    const rendered = baseRenderSection(section)
    if (!operatorSection) return rendered
    return (
      <OperatorSectionWrapper sectionKey={operatorSection.sectionKey}>
        {rendered}
      </OperatorSectionWrapper>
    )
  }

  return (
    <OperatorViewbookLayer
      viewbookId={data.viewbookId}
      operatorEmail={operatorEmail}
      stage={data.stage}
      pcCompletedAt={operatorData.pcCompletedAt}
      operatorData={operatorData}
    >
      <ViewbookShell
        token={token}
        data={data}
        primarySections={data.primarySections}
        carriedSections={data.carriedSections}
        renderSection={wrappedRenderSection}
      />
    </OperatorViewbookLayer>
  )
}
