// scripts/score-replay.ts — READ-ONLY ADA v4 score replay (C19 PR1 Task 6).
//
// Recomputes v4 scores for existing ADA runs from the findings tables
// (lib/scoring/ada-v4-inputs.server.ts) and prints before/after evidence —
// zero writes, ever. This is the before/after artifact for the C19 tracker
// entry, and the harness Task 7 (calibration sign-off) reads from.
//
// SAFETY: the ?mode=ro guard below MUST run before ANY module that
// transitively imports '@/lib/db' is loaded. A top-level static import of
// '@/lib/db' (or of a module that imports it, like
// '@/lib/scoring/ada-v4-inputs.server') would instantiate PrismaClient
// before the guard has a chance to refuse — so those imports are dynamic
// (`await import(...)`), deferred until AFTER the guard passes. Only pure,
// DB-free modules (lib/scoring/ada-v4) are statically imported at the top.
//
// Usage: DATABASE_URL="file:./local-dev.db?mode=ro" npx tsx scripts/score-replay.ts [--json]
import { computeAdaScoreV4, DEFAULT_ADA_V4_WEIGHTS, ADA_SCORE_VERSION } from '@/lib/scoring/ada-v4'
import type { AdaV4Inputs } from '@/lib/scoring/ada-v4'
import { parseScoreVersion } from '@/lib/scoring/breakdown-version'

// SEO v2 recalibration (C19 PR2). Pinned here rather than re-derived from a
// breakdown so the "already-v2" split has a single source of truth even for
// runs with no scoreBreakdown at all (parseScoreVersion degrades those to 1).
const SEO_SCORE_VERSION = 2

const EXPECTED_INVOCATION = 'DATABASE_URL="file:./local-dev.db?mode=ro" npx tsx scripts/score-replay.ts'

const BANDS = ['95+', '85-94', '70-84', '50-69', '<50'] as const
type Band = (typeof BANDS)[number]

interface RunRow {
  id: string
  domain: string | null
  score: number | null
  scoreBreakdown: string | null
}

interface ReplayRow {
  id: string
  domain: string
  old: number | null
  new: number
  delta: number | null
}

interface SkippedRow {
  id: string
  domain: string
  reason: string
}

// SEO section types. `ReplayRow` above is reused as-is for scored SF baseline
// rows (id/domain/old/new/delta) — same shape.
type SeoSource = 'sf-upload' | 'live-scan'

interface SfBaselineRow {
  id: string
  domain: string | null
  score: number | null
  scoreBreakdown: string | null
  sessionId: string | null
  session: { result: string | null } | null
}

interface LiveRunRow {
  id: string
  domain: string | null
  score: number | null
  scoreBreakdown: string | null
}

interface SeoSkippedRow {
  id: string
  domain: string
  reason: string
  source: SeoSource
}

interface AlreadyV2Row {
  id: string
  domain: string | null
  score: number | null
  source: SeoSource
}

function stampedVersion(scoreBreakdown: string | null): number | null {
  if (!scoreBreakdown) return null
  try {
    const parsed = JSON.parse(scoreBreakdown) as { version?: number }
    return typeof parsed.version === 'number' ? parsed.version : null
  } catch {
    return null
  }
}

function bandFor(score: number | null): Band | 'unscored' {
  if (score === null) return 'unscored'
  if (score >= 95) return '95+'
  if (score >= 85) return '85-94'
  if (score >= 70) return '70-84'
  if (score >= 50) return '50-69'
  return '<50'
}

function emptyBandCounts(): Record<Band, number> {
  return { '95+': 0, '85-94': 0, '70-84': 0, '50-69': 0, '<50': 0 }
}

function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s.padEnd(w)
}
function padNum(s: string, w: number): string {
  return s.padStart(w)
}

async function main() {
  // 1. Guard FIRST — before any DB-touching import.
  if (!process.env.DATABASE_URL?.includes('mode=ro')) {
    console.error('Refusing to run: DATABASE_URL must be a read-only connection.')
    console.error('This script recomputes scores for comparison ONLY — it must never be able to write.')
    console.error(`Expected invocation:\n  ${EXPECTED_INVOCATION}`)
    process.exit(1)
    return
  }

  const { prisma } = await import('@/lib/db')
  const { loadAdaV4InputsForRun } = await import('@/lib/scoring/ada-v4-inputs.server')
  const { computeHealthScore } = await import('@/lib/services/scoring.service')
  const { DEFAULT_WEIGHTS } = await import('@/lib/scoring/weights')

  const json = process.argv.includes('--json')

  // 2. Load ada-audit runs; split baseline (pre-v4) vs already-v4.
  const runs: RunRow[] = await prisma.crawlRun.findMany({
    where: { tool: 'ada-audit' },
    select: { id: true, domain: true, score: true, scoreBreakdown: true },
    orderBy: { createdAt: 'asc' },
  })

  const baseline: RunRow[] = []
  const alreadyV4: RunRow[] = []
  for (const r of runs) {
    const v = stampedVersion(r.scoreBreakdown)
    if (v !== null && v >= 4) alreadyV4.push(r)
    else baseline.push(r)
  }

  // 3. Per baseline run: build inputs, recompute, or skip with a reason.
  const rows: ReplayRow[] = []
  const skipped: SkippedRow[] = []
  const oldBands = emptyBandCounts()
  const newBands = emptyBandCounts()

  for (const r of baseline) {
    const domain = r.domain ?? '(no domain)'
    let inputs: AdaV4Inputs | null
    try {
      inputs = await loadAdaV4InputsForRun(r.id)
    } catch (err) {
      skipped.push({ id: r.id, domain, reason: `input load failed: ${(err as Error).message}` })
      continue
    }
    if (!inputs) {
      skipped.push({ id: r.id, domain, reason: 'zero scored pages' })
      continue
    }

    let newScore: number
    try {
      newScore = computeAdaScoreV4(inputs, DEFAULT_ADA_V4_WEIGHTS).score
    } catch (err) {
      skipped.push({ id: r.id, domain, reason: `scorer failed: ${(err as Error).message}` })
      continue
    }

    rows.push({
      id: r.id, domain, old: r.score, new: newScore,
      delta: r.score === null ? null : newScore - r.score,
    })
    const oldBand = bandFor(r.score)
    if (oldBand !== 'unscored') oldBands[oldBand] += 1
    newBands[bandFor(newScore) as Band] += 1
  }

  // 4. Load SEO runs (seo-parser); split baseline (pre-v2) vs already-v2,
  //    separately for SF-upload runs (blob-replayable) and live-scan runs
  //    (never replayable pre-C19 — inputs aren't reconstructible).
  const sfRuns: SfBaselineRow[] = await prisma.crawlRun.findMany({
    where: { tool: 'seo-parser', source: 'sf-upload' },
    select: {
      id: true, domain: true, score: true, scoreBreakdown: true, sessionId: true,
      session: { select: { result: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const liveRuns: LiveRunRow[] = await prisma.crawlRun.findMany({
    where: { tool: 'seo-parser', source: 'live-scan' },
    select: { id: true, domain: true, score: true, scoreBreakdown: true },
    orderBy: { createdAt: 'asc' },
  })

  const seoRows: ReplayRow[] = []
  const seoSkipped: SeoSkippedRow[] = []
  const seoAlreadyV2: AlreadyV2Row[] = []
  const seoOldBands = emptyBandCounts()
  const seoNewBands = emptyBandCounts()

  // 5. Per SF baseline run: replay from the origin Session blob, or skip
  //    with a reason. Never mutate — this only reads `session.result`.
  for (const r of sfRuns) {
    const domain = r.domain ?? '(no domain)'
    if (parseScoreVersion(r.scoreBreakdown) >= SEO_SCORE_VERSION) {
      seoAlreadyV2.push({ id: r.id, domain: r.domain, score: r.score, source: 'sf-upload' })
      continue
    }
    if (!r.sessionId) {
      seoSkipped.push({ id: r.id, domain, reason: 'orphaned', source: 'sf-upload' })
      continue
    }
    const blob = r.session?.result ?? null
    if (blob === null) {
      seoSkipped.push({ id: r.id, domain, reason: 'blob pruned', source: 'sf-upload' })
      continue
    }

    let newScore: number | null
    try {
      const parsed = JSON.parse(blob)
      try {
        newScore = computeHealthScore(parsed, DEFAULT_WEIGHTS).score
      } catch (err) {
        seoSkipped.push({ id: r.id, domain, reason: `scorer failed: ${(err as Error).message}`, source: 'sf-upload' })
        continue
      }
    } catch {
      seoSkipped.push({ id: r.id, domain, reason: 'blob unparseable', source: 'sf-upload' })
      continue
    }
    if (newScore === null) {
      seoSkipped.push({ id: r.id, domain, reason: 'scorer returned null', source: 'sf-upload' })
      continue
    }

    seoRows.push({
      id: r.id, domain, old: r.score, new: newScore,
      delta: r.score === null ? null : newScore - r.score,
    })
    const oldBand = bandFor(r.score)
    if (oldBand !== 'unscored') seoOldBands[oldBand] += 1
    seoNewBands[bandFor(newScore) as Band] += 1
  }

  // 6. Live-scan runs are never reconstructed — pre-v2 inputs (coverage,
  //    verification denominators) don't exist historically; a partial
  //    reconstruction would misstate the flip. Purely categorized.
  for (const r of liveRuns) {
    const domain = r.domain ?? '(no domain)'
    if (parseScoreVersion(r.scoreBreakdown) >= SEO_SCORE_VERSION) {
      seoAlreadyV2.push({ id: r.id, domain: r.domain, score: r.score, source: 'live-scan' })
    } else {
      seoSkipped.push({ id: r.id, domain, reason: 'inputs not reconstructible pre-C19', source: 'live-scan' })
    }
  }

  // 7. Output.
  if (json) {
    console.log(JSON.stringify({
      scoreVersion: ADA_SCORE_VERSION,
      generatedAt: new Date().toISOString(),
      baselineCount: baseline.length,
      rows,
      skipped,
      bands: { old: oldBands, new: newBands },
      alreadyV4: alreadyV4.map((r) => ({ id: r.id, domain: r.domain, score: r.score })),
      seo: {
        rows: seoRows,
        bands: { old: seoOldBands, new: seoNewBands },
        skipped: seoSkipped,
        alreadyV2: seoAlreadyV2,
      },
    }, null, 2))
    return
  }

  console.log(
    `ADA v4 score replay — ${rows.length} scored, ${skipped.length} skipped, ` +
    `${alreadyV4.length} already-v4 (excluded from the distribution)\n`,
  )

  console.log(`${pad('runId', 12)} ${pad('domain', 32)} ${padNum('old', 5)} ${padNum('new', 5)} ${padNum('Δ', 6)}`)
  for (const row of rows) {
    console.log(
      `${pad(row.id, 12)} ${pad(row.domain, 32)} ` +
      `${padNum(row.old === null ? '—' : String(row.old), 5)} ` +
      `${padNum(String(row.new), 5)} ` +
      `${padNum(row.delta === null ? '—' : (row.delta > 0 ? `+${row.delta}` : String(row.delta)), 6)}`,
    )
  }
  if (rows.length === 0) console.log('  (no baseline runs with scoreable pages)')

  console.log('\nBand histogram (old -> new):')
  for (const b of BANDS) console.log(`  ${pad(b, 7)} ${padNum(String(oldBands[b]), 4)} -> ${padNum(String(newBands[b]), 4)}`)

  if (skipped.length) {
    console.log('\nSkipped:')
    for (const s of skipped) console.log(`  ${pad(s.id, 12)} ${pad(s.domain, 32)} ${s.reason}`)
  }

  if (alreadyV4.length) {
    console.log('\nAlready v4 (reported separately, never mixed into the before/after):')
    for (const r of alreadyV4) console.log(`  ${pad(r.id, 12)} ${pad(r.domain ?? '(no domain)', 32)} score=${r.score}`)
  }

  // ── SEO section (SF-upload blob replay; live-scan runs honestly skipped) ──
  console.log(
    `\n\nSEO v2 score replay — ${seoRows.length} scored, ${seoSkipped.length} skipped, ` +
    `${seoAlreadyV2.length} already-v2 (excluded from the distribution)\n`,
  )

  console.log(`${pad('runId', 12)} ${pad('domain', 32)} ${padNum('old', 5)} ${padNum('new', 5)} ${padNum('Δ', 6)}`)
  for (const row of seoRows) {
    console.log(
      `${pad(row.id, 12)} ${pad(row.domain, 32)} ` +
      `${padNum(row.old === null ? '—' : String(row.old), 5)} ` +
      `${padNum(String(row.new), 5)} ` +
      `${padNum(row.delta === null ? '—' : (row.delta > 0 ? `+${row.delta}` : String(row.delta)), 6)}`,
    )
  }
  if (seoRows.length === 0) console.log('  (no SF baseline runs with a replayable session blob)')

  console.log('\nBand histogram (old -> new):')
  for (const b of BANDS) console.log(`  ${pad(b, 7)} ${padNum(String(seoOldBands[b]), 4)} -> ${padNum(String(seoNewBands[b]), 4)}`)

  if (seoSkipped.length) {
    const reasonCounts = new Map<string, number>()
    for (const s of seoSkipped) reasonCounts.set(s.reason, (reasonCounts.get(s.reason) ?? 0) + 1)

    console.log('\nSkipped (by reason):')
    for (const [reason, count] of reasonCounts) console.log(`  ${pad(reason, 40)} ${count}`)

    console.log('\nSkipped (detail):')
    for (const s of seoSkipped) console.log(`  ${pad(s.id, 12)} ${pad(s.domain, 32)} ${pad(s.source, 10)} ${s.reason}`)
  }

  if (seoAlreadyV2.length) {
    console.log('\nAlready v2 (reported separately, never mixed into the before/after):')
    for (const r of seoAlreadyV2) {
      console.log(`  ${pad(r.id, 12)} ${pad(r.domain ?? '(no domain)', 32)} ${pad(r.source, 10)} score=${r.score}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
