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
  const chip = resolveCsmChip(team, csmName)

  return (
    <nav
      aria-label="Viewbook progress"
      className="sticky top-0 z-40 border-b border-black/10 backdrop-blur"
      style={{ background: 'color-mix(in srgb, var(--vb-primary) 92%, transparent)' }}
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

        <ol className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
          {steps.map((step, i) => (
            <li key={step.key} className="flex items-center gap-2">
              {i > 0 ? (
                <span aria-hidden="true" style={{ color: 'var(--vb-on-primary)', opacity: 0.4 }}>
                  /
                </span>
              ) : null}
              <span
                data-state={step.state}
                style={{
                  color: 'var(--vb-on-primary)',
                  opacity: step.state === 'upcoming' ? 0.5 : 1,
                  paddingBottom: 2,
                  borderBottom:
                    step.state === 'current'
                      ? '2px solid var(--vb-tertiary)'
                      : '2px solid transparent',
                }}
              >
                {step.label}
              </span>
            </li>
          ))}
        </ol>

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
