// lib/services/keyword-profile.ts
// KS-3 keyword-profile service. Concurrency posture: documented
// last-writer-wins on whole columns (single-operator tool, KS3-Codex #5);
// the UI refetches the whole profile after every mutation. suggestPrograms
// writes ONLY programSuggestionsJson — it can never clobber a roster edit.

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  parsePrograms, parseSuggestions, normalizeProgramName,
  type InstitutionType, type ProgramEntry, type ProgramSuggestions,
} from '@/lib/keywords/program-roster'
import { deriveProgramSuggestions } from '@/lib/keywords/program-suggest'

export interface KeywordProfile {
  institutionType: string | null
  programs: ProgramEntry[]
  suggestions: ProgramSuggestions | null
  locale: { locationCode: number; languageCode: string; marketLabel: string | null } | null
  hasLiveScan: boolean // powers the card's "Suggest from latest scan" initial state
}

const LIVE_SCAN_WHERE = { source: 'live-scan', tool: 'seo-parser' } as const

async function hasLiveScanRun(clientId: number): Promise<boolean> {
  const run = await prisma.crawlRun.findFirst({
    where: { clientId, ...LIVE_SCAN_WHERE },
    select: { id: true },
  })
  return run !== null
}

const PROFILE_SELECT = {
  institutionType: true, programsJson: true, programSuggestionsJson: true,
  kwLocationCode: true, kwLanguageCode: true, kwMarketLabel: true, archivedAt: true,
} as const

type ProfileRow = {
  institutionType: string | null
  programsJson: string | null
  programSuggestionsJson: string | null
  kwLocationCode: number | null
  kwLanguageCode: string | null
  kwMarketLabel: string | null
}

function toProfile(row: ProfileRow, hasLiveScan: boolean): KeywordProfile {
  return {
    institutionType: row.institutionType,
    programs: parsePrograms(row.programsJson),
    suggestions: parseSuggestions(row.programSuggestionsJson),
    locale:
      row.kwLocationCode != null && row.kwLanguageCode != null
        ? { locationCode: row.kwLocationCode, languageCode: row.kwLanguageCode, marketLabel: row.kwMarketLabel }
        : null,
    hasLiveScan,
  }
}

export async function getKeywordProfile(clientId: number): Promise<KeywordProfile | null> {
  const row = await prisma.client.findUnique({ where: { id: clientId }, select: PROFILE_SELECT })
  if (!row) return null
  return toProfile(row, await hasLiveScanRun(clientId))
}

export type UpdateResult =
  | { ok: true; profile: KeywordProfile }
  | { ok: false; error: 'client_not_found' | 'client_archived' | 'suggestion_not_found' }

export async function updateKeywordProfile(
  clientId: number,
  patch: {
    institutionType?: InstitutionType | null
    programs?: ProgramEntry[]
    locale?: { locationCode: number; languageCode: string; marketLabel?: string | null } | null
    confirmSuggestion?: string
    dismissSuggestion?: string
  },
): Promise<UpdateResult> {
  const row = await prisma.client.findUnique({ where: { id: clientId }, select: PROFILE_SELECT })
  if (!row) return { ok: false, error: 'client_not_found' }
  if (row.archivedAt) return { ok: false, error: 'client_archived' }

  const data: Prisma.ClientUpdateInput = {}
  if ('institutionType' in patch) data.institutionType = patch.institutionType
  if ('programs' in patch && patch.programs) data.programsJson = JSON.stringify(patch.programs)
  if ('locale' in patch) {
    if (patch.locale === null) {
      data.kwLocationCode = null
      data.kwLanguageCode = null
      data.kwMarketLabel = null
    } else if (patch.locale) {
      data.kwLocationCode = patch.locale.locationCode
      data.kwLanguageCode = patch.locale.languageCode
      data.kwMarketLabel = patch.locale.marketLabel ?? null
    }
  }

  const opName = patch.confirmSuggestion ?? patch.dismissSuggestion
  if (opName != null) {
    const suggestions = parseSuggestions(row.programSuggestionsJson)
    const key = normalizeProgramName(opName)
    const hit = suggestions?.suggestions.find((s) => normalizeProgramName(s.name) === key)
    if (!suggestions || !hit) return { ok: false, error: 'suggestion_not_found' }
    const remaining = suggestions.suggestions.filter((s) => s !== hit)
    if (patch.confirmSuggestion != null) {
      const roster = parsePrograms(row.programsJson)
      if (!roster.some((e) => normalizeProgramName(e.name) === key)) {
        roster.push({
          name: hit.name.slice(0, 200), // belt-and-braces vs validatePrograms' cap (plan-Codex #5)
          ...(hit.url ? { url: hit.url } : {}),
          confirmed: true,
          source: 'suggested',
          addedAt: new Date().toISOString(),
        })
        data.programsJson = JSON.stringify(roster)
      }
      data.programSuggestionsJson = JSON.stringify({ ...suggestions, suggestions: remaining })
    } else {
      data.programSuggestionsJson = JSON.stringify({
        ...suggestions,
        suggestions: remaining,
        dismissedNames: [...suggestions.dismissedNames, key],
      })
    }
  }

  const updated = await prisma.client.update({ where: { id: clientId }, data, select: PROFILE_SELECT })
  return { ok: true, profile: toProfile(updated, await hasLiveScanRun(clientId)) }
}

export async function suggestPrograms(
  clientId: number,
): Promise<{ ok: true; suggestions: ProgramSuggestions } | { ok: false; error: 'client_not_found' | 'client_archived' | 'no_live_scan_run' }> {
  const row = await prisma.client.findUnique({ where: { id: clientId }, select: PROFILE_SELECT })
  if (!row) return { ok: false, error: 'client_not_found' }
  if (row.archivedAt) return { ok: false, error: 'client_archived' }

  // KS-1 precedent: id DESC tiebreaker for same-timestamp rows (plan-Codex #5).
  const run = await prisma.crawlRun.findFirst({
    where: { clientId, ...LIVE_SCAN_WHERE },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, programEntitiesJson: true },
  })
  if (!run) return { ok: false, error: 'no_live_scan_run' }

  const pages = await prisma.crawlPage.findMany({
    where: { runId: run.id },
    select: { url: true, title: true, h1: true, statusCode: true, indexable: true, crawlDepth: true },
  })

  // Validate durable JSON before trusting it (plan-Codex #3) — never cast
  // unknown persisted JSON straight into the derivation input.
  let entities: { name: string; url: string }[] = []
  if (run.programEntitiesJson) {
    try {
      const parsed = JSON.parse(run.programEntitiesJson) as { v?: number; entities?: unknown }
      if (parsed.v === 1 && Array.isArray(parsed.entities)) {
        entities = parsed.entities.filter(
          (e): e is { name: string; url: string } =>
            !!e && typeof e === 'object' &&
            typeof (e as { name?: unknown }).name === 'string' &&
            typeof (e as { url?: unknown }).url === 'string',
        )
      }
    } catch { /* degrade to slug-only */ }
  }

  const prior = parseSuggestions(row.programSuggestionsJson)
  const dismissedNames = prior?.dismissedNames ?? []
  const confirmedNames = parsePrograms(row.programsJson).map((e) => normalizeProgramName(e.name))

  const suggestions: ProgramSuggestions = {
    v: 1,
    derivedFromRunId: run.id,
    derivedAt: new Date().toISOString(),
    suggestions: deriveProgramSuggestions({ pages, programEntities: entities, confirmedNames, dismissedNames }),
    dismissedNames,
  }

  await prisma.client.update({
    where: { id: clientId },
    data: { programSuggestionsJson: JSON.stringify(suggestions) },
  })
  return { ok: true, suggestions }
}
