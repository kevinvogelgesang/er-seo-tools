// lib/keywords/strategy-export.ts
//
// KS-5 export assembly — the five-block payload the er-handoff-memo skill
// consumes over GET /api/keyword-strategy/[id] (spec §7). SERVER-ONLY (imports
// prisma via the KS-1/KS-3 services); never import from a client component.
//
// Each block degrades INDEPENDENTLY: a missing/corrupt data source yields a
// null (or sparse, for profile) block, never a thrown error that fails the
// whole fetch — the skill's "When to Ask" rules own the gap handling.
import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import { getKeywordProfile } from '@/lib/services/keyword-profile'
import { getLatestGscSnapshot } from '@/lib/keywords/gsc-snapshot'
import type { GscSnapshotSummary } from '@/lib/keywords/types'
import { buildPageInventory, type PageInventoryEntry } from '@/lib/keywords/page-inventory'
import {
  ONPAGE_FINDING_TYPE_SET,
  BROKEN_FINDING_TYPE_SET,
} from '@/lib/findings/finding-type-sets'
import { buildKeywordResearchExport, type KeywordResearchExport } from '@/lib/parsers/keyword-research-export'
import type { AggregatedResult } from '@/lib/types'
import { isVolumeEnabled } from '@/lib/keywords/volume-config'
import type { ProgramEntry } from '@/lib/keywords/program-roster'

export interface StrategyExportProfile {
  institutionType: string | null
  programs: ProgramEntry[]
  locale: { locationCode: number; languageCode: string; marketLabel: string | null } | null
}

export interface StrategyExportGsc {
  gscMapped: boolean
  refreshedAtMint: boolean
  summary: GscSnapshotSummary | null
}

export interface StrategyExportInventory {
  runId: string
  runCreatedAt: string
  domain: string | null
  runScore: number | null
  pagesTotal: number
  indexablePages: number
  pages: PageInventoryEntry[]
}

export interface StrategyFindingEntry {
  type: string
  severity: string
  scope: string
  count: number
  url: string | null
}

export interface StrategyExportFindings {
  onPage: StrategyFindingEntry[]
  brokenLinks: StrategyFindingEntry[]
}

export interface StrategyExportVolumeLookup {
  enabled: boolean
  endpoint: string
  cap: number
  used: number
  locale: { locationCode: number; languageCode: string } | null
}

export interface StrategyExport {
  id: string
  clientId: number
  siteName: string | null
  generatedAt: string
  profile: StrategyExportProfile
  gsc: StrategyExportGsc | null
  inventory: StrategyExportInventory | null
  findings: StrategyExportFindings | null
  semrush: KeywordResearchExport | null
  volumeLookup: StrategyExportVolumeLookup
}

const LIVE_SCAN_WHERE = { source: 'live-scan', tool: 'seo-parser' } as const

const SPARSE_PROFILE: StrategyExportProfile = {
  institutionType: null,
  programs: [],
  locale: null,
}

// Mirror the durable-JSON validation in keyword-profile.ts's suggestPrograms:
// never trust the persisted shape, degrade to no upgrade on anything off-spec.
function parseProgramEntityUrls(json: string | null): string[] | undefined {
  if (!json) return undefined
  try {
    const parsed = JSON.parse(json) as { v?: number; entities?: unknown }
    if (parsed.v === 1 && Array.isArray(parsed.entities)) {
      const urls = parsed.entities
        .filter(
          (e): e is { name: string; url: string } =>
            !!e &&
            typeof e === 'object' &&
            typeof (e as { name?: unknown }).name === 'string' &&
            typeof (e as { url?: unknown }).url === 'string',
        )
        .map((e) => e.url)
      return urls.length > 0 ? urls : undefined
    }
  } catch {
    /* degrade to no upgrade */
  }
  return undefined
}

async function loadProfileBlock(clientId: number): Promise<StrategyExportProfile> {
  try {
    const profile = await getKeywordProfile(clientId)
    if (!profile) return SPARSE_PROFILE
    return {
      institutionType: profile.institutionType,
      programs: profile.programs,
      locale: profile.locale,
    }
  } catch (err) {
    logError({ clientId, block: 'profile' }, err)
    return SPARSE_PROFILE
  }
}

async function loadGscBlock(
  clientId: number,
  refreshedAtMint: boolean,
): Promise<StrategyExportGsc | null> {
  try {
    const { gscMapped, summary } = await getLatestGscSnapshot(clientId)
    return { gscMapped, refreshedAtMint, summary }
  } catch (err) {
    logError({ clientId, block: 'gsc' }, err)
    return null
  }
}

async function loadInventoryAndFindings(
  clientId: number,
): Promise<{ inventory: StrategyExportInventory | null; findings: StrategyExportFindings | null }> {
  try {
    // Run resolution follows the KS-3 suggestPrograms precedent EXACTLY:
    // newest live-scan seo-parser run, deterministic id-desc tie-break, NO
    // seoIntent filter (every C6 Phase 2+ site-audit live-scan carries the
    // on-page harvest + KS-4 FAQ scalar).
    const run = await prisma.crawlRun.findFirst({
      where: { clientId, ...LIVE_SCAN_WHERE },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        createdAt: true,
        domain: true,
        score: true,
        pagesTotal: true,
        programEntitiesJson: true,
      },
    })
    if (!run) return { inventory: null, findings: null }

    const pages = await prisma.crawlPage.findMany({
      where: { runId: run.id },
      select: {
        url: true,
        title: true,
        h1: true,
        wordCount: true,
        crawlDepth: true,
        indexable: true,
        faqEvidence: true,
      },
    })
    const programEntityUrls = parseProgramEntityUrls(run.programEntitiesJson)
    const inventoryPages = buildPageInventory(pages, { programEntityUrls })
    const indexablePages = pages.reduce((n, p) => (p.indexable === true ? n + 1 : n), 0)

    const inventory: StrategyExportInventory = {
      runId: run.id,
      runCreatedAt: run.createdAt.toISOString(),
      domain: run.domain,
      runScore: run.score,
      pagesTotal: run.pagesTotal,
      indexablePages,
      pages: inventoryPages,
    }

    const findingRows = await prisma.finding.findMany({
      where: { runId: run.id, scope: 'run' },
      select: { type: true, severity: true, scope: true, count: true, url: true },
    })
    const findings: StrategyExportFindings = { onPage: [], brokenLinks: [] }
    for (const f of findingRows) {
      const entry: StrategyFindingEntry = {
        type: f.type,
        severity: f.severity,
        scope: f.scope,
        count: f.count,
        url: f.url,
      }
      if (ONPAGE_FINDING_TYPE_SET.has(f.type)) findings.onPage.push(entry)
      else if (BROKEN_FINDING_TYPE_SET.has(f.type)) findings.brokenLinks.push(entry)
    }

    return { inventory, findings }
  } catch (err) {
    logError({ clientId, block: 'inventory' }, err)
    return { inventory: null, findings: null }
  }
}

async function loadSemrushBlock(clientId: number): Promise<KeywordResearchExport | null> {
  try {
    const session = await prisma.session.findFirst({
      where: { clientId, workflow: 'keyword-research', status: 'complete', result: { not: null } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { result: true },
    })
    if (!session?.result) return null
    const parsed = JSON.parse(session.result) as AggregatedResult
    return buildKeywordResearchExport(parsed)
  } catch (err) {
    logError({ clientId, block: 'semrush' }, err)
    return null
  }
}

export async function loadStrategyExport(sessionId: string): Promise<StrategyExport | null> {
  const row = await prisma.keywordStrategySession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      clientId: true,
      gscRefreshed: true,
      volumeKeywordCap: true,
      volumeKeywordsUsed: true,
      client: { select: { name: true } },
    },
  })
  if (!row) return null

  const [profile, gsc, invFindings, semrush] = await Promise.all([
    loadProfileBlock(row.clientId),
    loadGscBlock(row.clientId, row.gscRefreshed),
    loadInventoryAndFindings(row.clientId),
    loadSemrushBlock(row.clientId),
  ])

  const volumeLookup: StrategyExportVolumeLookup = {
    enabled: isVolumeEnabled(),
    endpoint: `/api/keyword-strategy/${sessionId}/volumes`,
    cap: row.volumeKeywordCap,
    used: row.volumeKeywordsUsed,
    locale: profile.locale
      ? { locationCode: profile.locale.locationCode, languageCode: profile.locale.languageCode }
      : null,
  }

  return {
    id: row.id,
    clientId: row.clientId,
    siteName: row.client?.name ?? null,
    generatedAt: new Date().toISOString(),
    profile,
    gsc,
    inventory: invFindings.inventory,
    findings: invFindings.findings,
    semrush,
    volumeLookup,
  }
}
