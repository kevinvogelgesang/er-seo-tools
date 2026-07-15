// components/sales/intake/progress-math.ts
//
// Pure, client-safe progress + ETA math for the /sales prospect dashboard
// (PR3). NO imports, NO Date.now()/timers — callers inject `now`. Heavily
// unit-tested so ProspectDashboard.tsx stays thin.
//
// Weighted phases: pages 70% / PDFs 15% / Lighthouse 15%.
// Settled pages = pagesComplete + pagesError + pagesRedirected — the
// finalizer's EXACT drain semantics (site-audit-finalizer.ts, Codex fix 3).
//
// Monotonicity contract (Codex fix 3): while pages are still settling, the
// PDF/Lighthouse totals are still GROWING (each page job dispatches PDFs and
// PSI as it settles), so their fractions have unstable denominators — a
// growing total would move the bar backward. Until the pages phase is done,
// the PDF/LH weights are RESERVED (contribute 0, shown as pending); once
// pages are done the totals are final, and any phase with total 0 folds its
// weight away (renormalized denominator). The fraction never decreases:
// pre-transition f ≤ 0.70; post-transition f = (0.70 + …)/activeWeight ≥ 0.70.

export const PHASE_WEIGHTS = { pages: 0.7, pdfs: 0.15, lighthouse: 0.15 } as const

export interface AuditProgressInput {
  status: string
  reportable: boolean
  pagesTotal: number
  pagesComplete: number
  pagesError: number
  pagesRedirected: number
  pdfsTotal: number
  pdfsComplete: number
  pdfsError: number
  pdfsSkipped: number
  lighthouseTotal: number
  lighthouseComplete: number
  lighthouseError: number
}

export type AuditProgress =
  | { kind: 'queued' }
  | { kind: 'discovering' }
  | { kind: 'progress'; fraction: number; phaseLabel: string }
  | { kind: 'building-report'; fraction: 1 }
  | { kind: 'none' }

const TRANSIENT_STATUSES = new Set(['running', 'pdfs-running', 'lighthouse-running'])

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

export function computeAuditProgress(input: AuditProgressInput): AuditProgress {
  if (input.status === 'queued') return { kind: 'queued' }

  // The broken-link-verify window: parent complete, live-scan run not yet
  // written — full bar, "Building report…" (spec §2).
  if (input.status === 'complete' && !input.reportable) {
    return { kind: 'building-report', fraction: 1 }
  }

  if (!TRANSIENT_STATUSES.has(input.status)) return { kind: 'none' }

  // pagesTotal === 0 while transient = discovery still in flight —
  // indeterminate bar, no ETA (spec Error handling).
  if (input.pagesTotal === 0) return { kind: 'discovering' }

  const pagesSettled = input.pagesComplete + input.pagesError + input.pagesRedirected
  const pagesFraction = clamp01(pagesSettled / input.pagesTotal)
  const pagesDone = pagesSettled >= input.pagesTotal

  if (!pagesDone) {
    // PDF/LH weights reserved — see the monotonicity contract above.
    return {
      kind: 'progress',
      fraction: PHASE_WEIGHTS.pages * pagesFraction,
      phaseLabel: `Scanning pages (${Math.min(pagesSettled, input.pagesTotal)}/${input.pagesTotal})`,
    }
  }

  // Pages done → PDF/LH totals are final. Zero-total phases fold their
  // weight away via the renormalized denominator.
  const pdfsSettled = input.pdfsComplete + input.pdfsError + input.pdfsSkipped
  const lhSettled = input.lighthouseComplete + input.lighthouseError
  const pdfsFraction = input.pdfsTotal > 0 ? clamp01(pdfsSettled / input.pdfsTotal) : 0
  const lhFraction = input.lighthouseTotal > 0 ? clamp01(lhSettled / input.lighthouseTotal) : 0
  const activeWeight =
    PHASE_WEIGHTS.pages +
    (input.pdfsTotal > 0 ? PHASE_WEIGHTS.pdfs : 0) +
    (input.lighthouseTotal > 0 ? PHASE_WEIGHTS.lighthouse : 0)
  const fraction = clamp01(
    (PHASE_WEIGHTS.pages +
      (input.pdfsTotal > 0 ? PHASE_WEIGHTS.pdfs * pdfsFraction : 0) +
      (input.lighthouseTotal > 0 ? PHASE_WEIGHTS.lighthouse * lhFraction : 0)) /
      activeWeight,
  )

  const phaseLabel =
    input.status === 'pdfs-running'
      ? `Scanning PDFs (${Math.min(pdfsSettled, input.pdfsTotal)}/${input.pdfsTotal})`
      : input.status === 'lighthouse-running'
        ? `Running Lighthouse (${Math.min(lhSettled, input.lighthouseTotal)}/${input.lighthouseTotal})`
        : 'Finishing up…' // status still 'running' with pages drained — finalizer flip imminent

  return { kind: 'progress', fraction, phaseLabel }
}

/**
 * ETA = elapsed × (1 − f) / f, elapsed from SiteAudit.startedAt (stamped by
 * the discover claim — queue wait excluded, Codex fix 4). Presentation-only.
 * Gates: no ETA at all while startedAt is null; "estimating…" until
 * f ≥ 0.05 AND elapsed ≥ 20 s. Format "~N min remaining" (floor ~1 min,
 * cap "> 30 min remaining").
 */
export function computeEtaLabel(args: {
  fraction: number
  startedAt: string | null
  now: number
}): string | null {
  const { fraction, startedAt, now } = args
  if (startedAt === null) return null
  if (fraction >= 1) return null
  const startedMs = Date.parse(startedAt)
  if (Number.isNaN(startedMs)) return null
  const elapsed = now - startedMs
  // f ≤ 0 falls into this gate too — never divide by a non-positive fraction.
  if (fraction < 0.05 || elapsed < 20_000) return 'estimating…'
  const remainingMs = (elapsed * (1 - fraction)) / fraction
  if (remainingMs > 30 * 60_000) return '> 30 min remaining'
  const minutes = Math.round(remainingMs / 60_000)
  if (minutes <= 1) return '~1 min remaining'
  return `~${minutes} min remaining`
}
