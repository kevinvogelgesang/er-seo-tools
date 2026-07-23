import type { Metadata } from 'next'
import { GlobalContentEditor } from '@/components/viewbook/admin/GlobalContentEditor'
import { SectionCopyEditor } from '@/components/viewbook/admin/SectionCopyEditor'
import { SECTION_KEYS } from '@/lib/viewbook/theme'
import { getSectionCopyGlobalMap, resolveSectionCopy } from '@/lib/viewbook/section-copy-content'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Onboarding Viewbook Company Content' }

export default async function ViewbookSettingsPage() {
  const globalMap = await getSectionCopyGlobalMap()
  const initial = Object.fromEntries(
    SECTION_KEYS.map((k) => [k, resolveSectionCopy(k, globalMap[k] ?? null, null)]),
  ) as Record<(typeof SECTION_KEYS)[number], ReturnType<typeof resolveSectionCopy>>

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-heading font-bold text-navy dark:text-white">Onboarding Viewbook company content</h1>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          Team, process, and base SEO/GEO/E-E-A-T strategy — edited once, rendered into every viewbook.
        </p>
      </header>
      <GlobalContentEditor />
      <section className="space-y-3">
        <h2 className="text-xl font-heading font-bold text-navy dark:text-white">Section copy</h2>
        <p className="text-[13px] text-navy/50 dark:text-white/50">
          The ⓘ tooltip beside each section heading — edited once, rendered into every viewbook (per-viewbook overrides
          live in each viewbook&apos;s editor).
        </p>
        <SectionCopyEditor sectionKeys={SECTION_KEYS} initial={initial} />
      </section>
    </div>
  )
}
