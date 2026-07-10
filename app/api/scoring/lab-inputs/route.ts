// GET /api/scoring/lab-inputs — Score Lab data source (C19 PR3). Cookie-gated
// by default (no middleware entry). ?list=1 → recent complete runs to pick
// from; ?runId= → a compact scoring-inputs payload the browser can re-score
// with the pure scorers. ADA works for ANY run with findings tables (90-d
// archives included); SEO what-if needs the v2 breakdown's inputsSnapshot —
// pre-C19 runs surface as kind:'unavailable'. No blob reads here, ever.
import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { loadAdaV4InputsForRun } from '@/lib/scoring/ada-v4-inputs.server'
import { parseScoreMeta } from '@/lib/scoring/breakdown-version'
import type { SeoInputsSnapshot } from '@/lib/scoring/seo-core'

export const GET = withRoute(async (request: NextRequest) => {
  const url = new URL(request.url)
  if (url.searchParams.get('list') === '1') {
    const runs = await prisma.crawlRun.findMany({
      where: { status: 'complete' },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { id: true, domain: true, tool: true, source: true, score: true, createdAt: true },
    })
    return NextResponse.json({ runs })
  }

  const runId = url.searchParams.get('runId')
  if (!runId) throw new HttpError(400, 'missing_run_id')
  const run = await prisma.crawlRun.findUnique({
    where: { id: runId },
    select: { id: true, tool: true, source: true, status: true, score: true, scoreBreakdown: true, domain: true },
  })
  if (!run) throw new HttpError(404, 'not_found')

  const meta = parseScoreMeta(run.scoreBreakdown)
  const current = {
    score: run.score, version: meta.version, weightsHash: meta.weightsHash,
    domain: run.domain, tool: run.tool, source: run.source,
  }

  // Codex #4: the list only offers complete runs, but runId is user-supplied —
  // a partial run's inputs/snapshot describe an unfinished crawl.
  if (run.status !== 'complete') {
    return NextResponse.json({ kind: 'unavailable', reason: 'run is not complete', current })
  }

  if (run.tool === 'ada-audit') {
    const inputs = await loadAdaV4InputsForRun(runId)
    if (!inputs) return NextResponse.json({ kind: 'unavailable', reason: 'no scored pages on this run', current })
    return NextResponse.json({ kind: 'ada', inputs, current })
  }

  // seo-parser: only post-C19 v2 breakdowns carry the raw-inputs snapshot.
  if (run.scoreBreakdown) {
    try {
      const parsed = JSON.parse(run.scoreBreakdown) as {
        version?: unknown; scorer?: unknown; inputsSnapshot?: unknown
      }
      if (parsed.version === 2 && (parsed.scorer === 'health' || parsed.scorer === 'live-seo')
          && isValidSeoSnapshot(parsed.inputsSnapshot)) {
        return NextResponse.json({ kind: 'seo', scorer: parsed.scorer, snapshot: parsed.inputsSnapshot, current })
      }
    } catch { /* fall through to unavailable */ }
  }
  return NextResponse.json({ kind: 'unavailable', reason: 'what-if unavailable (scored before C19 — no inputs snapshot)', current })
})

// Codex #4: never ship a malformed/non-finite snapshot to the client recompute.
// Checks the discriminant + every REQUIRED numeric field of the matching variant
// (nullable/optional fields — avgCrawlDepth, thinCount, pagesWithSchema,
// linkVerification, the availability booleans — are shape-checked only if present).
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
function isValidSeoSnapshot(v: unknown): v is SeoInputsSnapshot {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  if (s.source === 'sf') {
    return (['totalUrls', 'indexableUrls', 'clientErrors', 'serverErrors', 'base', 'missingTitle', 'missingMeta', 'missingH1'] as const)
      .every((k) => finite(s[k]))
  }
  if (s.source === 'live') {
    return (['attempted', 'observed', 'indexableScored', 'pagesError', 'missingTitle', 'missingMeta', 'missingH1', 'thin', 'pagesWithSchema'] as const)
      .every((k) => finite(s[k]))
  }
  return false
}
