// Matured sticky header (v2 spec §8): client logo + displayName, a 4-step
// STAGE STEPPER (done/current/upcoming), and a CSM chip (photo + name +
// mailto). Per-section anchor dots MOVED OUT to the floating TOC rail (Task
// 9) — ProgressNav v2 renders NO section dots. Pure server component, no
// client JS; light-only (public viewbook never participates in app dark
// mode — no `dark:` classes here).
import type { TeamMember } from '@/lib/viewbook/global-content-keys'
import { resolveCsmChip } from '@/lib/viewbook/csm-chip'
import { stageSteps } from '@/lib/viewbook/stage-progress'
import type { ViewbookStage } from '@/lib/viewbook/stages'
import { publicAssetUrl } from './ThemeStyle'

export function ProgressNav({
  token,
  displayName,
  logoUrl,
  stage,
  csmName,
  team,
}: {
  token: string
  displayName: string
  logoUrl: string | null
  stage: ViewbookStage
  csmName: string | null
  team: TeamMember[] | null | undefined
}) {
  const steps = stageSteps(stage)
  const currentIndex = Math.max(0, steps.findIndex((step) => step.state === 'current'))
  const currentStep = steps[currentIndex]
  const chip = resolveCsmChip(team, csmName)

  return (
    <nav
      id="vb-progress-nav"
      aria-label="Viewbook progress"
      className="sticky z-40 border-b border-black/10 backdrop-blur"
      style={{
        top: 'var(--vb-operator-bar-height, 0px)',
        background: 'color-mix(in srgb, var(--vb-primary) 92%, transparent)',
      }}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-6 py-2">
        <div className="flex items-center gap-2">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={displayName} className="h-8 w-auto" />
          ) : null}
          <span
            className="text-sm font-bold"
            style={{ color: 'var(--vb-on-primary)', fontFamily: 'var(--vb-heading-font)' }}
          >
            {displayName}
          </span>
        </div>

        {/* One stage at a time (2026-07-20 header refactor): eyebrow with the
            step count, the CURRENT stage label, and a slim progress bar —
            replaces the full inline stepper. */}
        <div aria-label={`Stage ${currentIndex + 1} of ${steps.length}: ${currentStep.label}`}>
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: 'var(--vb-on-primary)', opacity: 0.65 }}
          >
            Stage {currentIndex + 1} of {steps.length}
          </p>
          <div className="mt-0.5 flex items-center gap-2">
            <span
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--vb-on-primary)' }}
            >
              {currentStep.label}
            </span>
            <span
              aria-hidden="true"
              className="flex h-1 w-20 overflow-hidden rounded-full"
              style={{ background: 'color-mix(in srgb, var(--vb-on-primary) 25%, transparent)' }}
            >
              <span
                className="h-full rounded-full transition-[width]"
                style={{
                  width: `${((currentIndex + 1) / steps.length) * 100}%`,
                  background: 'var(--vb-tertiary)',
                }}
              />
            </span>
          </div>
        </div>

        {chip ? (
          <div className="ml-auto flex items-center gap-2">
            {chip.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={publicAssetUrl(token, chip.photo)}
                alt={chip.name}
                className="h-7 w-7 rounded-full object-cover"
              />
            ) : null}
            <div className="text-xs leading-tight" style={{ color: 'var(--vb-on-primary)' }}>
              {/* Context eyebrow (2026-07-20): a bare name + email read as
                  stranded info — say who this person is to the client. */}
              <div className="text-[9px] font-semibold uppercase tracking-[0.14em] opacity-65">
                Your ER contact
              </div>
              <div className="font-semibold">{chip.name}</div>
              {chip.email ? (
                <a
                  href={`mailto:${chip.email}`}
                  className="underline opacity-80 hover:opacity-100"
                >
                  {chip.email}
                </a>
              ) : (
                <div className="opacity-70">{chip.role}</div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </nav>
  )
}
