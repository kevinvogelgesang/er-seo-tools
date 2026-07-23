import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import type { PublicSection } from '@/lib/viewbook/public-types'
import type { SectionRenderMeta } from '@/lib/viewbook/section-status'
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
import { loadOperatorViewbookData } from '@/lib/viewbook/operator-data'
import { resolveThemeFonts } from '@/lib/viewbook/theme-server'
import { resolveViewbookPrincipalRSC } from '@/lib/viewbook/principal'
import { OperatorViewbookLayer, OperatorSectionWrapper } from '@/components/viewbook/public/OperatorLayer'
import { AuthLanding } from '@/components/viewbook/public/AuthLanding'
import { FragmentScrubber } from '@/components/viewbook/public/FragmentScrubber'
import { MemberSessionBar } from '@/components/viewbook/public/MemberSessionBar'

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
  if (!token || token.length > 128) notFound()
  const viewbook = await prisma.viewbook.findUnique({
    where: { token },
    select: { id: true, revokedAt: true, client: { select: { archivedAt: true } } },
  })
  if (!viewbook || viewbook.revokedAt || viewbook.client.archivedAt) notFound()

  const principal = await resolveViewbookPrincipalRSC({ id: viewbook.id })
  if (principal == null) return <AuthLanding token={token} />

  const data = await loadViewbookPublicData(token)
  if (!data) notFound()
  const resolvedFonts = resolveThemeFonts(data.theme)
  const isOperator = principal.kind === 'operator' || principal.kind === 'dev'

  const baseRenderSection = (section: PublicSection, meta: SectionRenderMeta): ReactNode => {
    const props = { section, data, token, isOperator, meta }
    switch (section.sectionKey) {
      case 'welcome':
        return <WelcomeSection {...props} />
      case 'milestones':
        return <MilestonesSection {...props} />
      case 'data-source':
        return <DataSourceSection {...props} />
      case 'brand':
        return <BrandSection {...props} resolvedFonts={resolvedFonts} />
      case 'assessment':
        return <AssessmentSection {...props} />
      case 'strategy':
        return <StrategySection {...props} />
      case 'materials':
        return <MaterialsSection {...props} />
      case 'kickoff-next':
        return <KickoffNextSection {...props} />
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

  if (!isOperator) {
    const shell = (
      <ViewbookShell
        token={token}
        data={data}
        renderSection={baseRenderSection}
        resolvedFonts={resolvedFonts}
      />
    )
    return (
      <>
        <FragmentScrubber />
        {principal.kind === 'member' ? (
          <>
            <MemberSessionBar token={token} name={principal.member.name} />
            {shell}
          </>
        ) : shell}
      </>
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
  const wrappedRenderSection = (section: PublicSection, meta: SectionRenderMeta): ReactNode => {
    const operatorSection = operatorData.sections.find((item) => item.sectionKey === section.sectionKey)
    const rendered = baseRenderSection(section, meta)
    if (!operatorSection) return rendered
    return (
      <OperatorSectionWrapper sectionKey={operatorSection.sectionKey}>
        {rendered}
      </OperatorSectionWrapper>
    )
  }

  return (
    <>
      <FragmentScrubber />
      <OperatorViewbookLayer
        viewbookId={data.viewbookId}
        operatorEmail={principal.email}
        stage={data.stage}
        pcCompletedAt={operatorData.pcCompletedAt}
        operatorData={operatorData}
      >
        <ViewbookShell
          token={token}
          data={data}
          renderSection={wrappedRenderSection}
          resolvedFonts={resolvedFonts}
        />
      </OperatorViewbookLayer>
    </>
  )
}
