import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { getKeywordProfile, updateKeywordProfile, suggestPrograms } from './keyword-profile'

let clientId: number
const cleanupIds: number[] = []

beforeEach(async () => {
  const c = await prisma.client.create({ data: { name: `ks3-test-${Date.now()}-${Math.random()}` } })
  clientId = c.id
  cleanupIds.push(c.id)
})

afterEach(async () => {
  await prisma.crawlRun.deleteMany({ where: { clientId: { in: cleanupIds } } })
  await prisma.client.deleteMany({ where: { id: { in: cleanupIds } } })
  cleanupIds.length = 0
})

describe('getKeywordProfile', () => {
  it('null for unknown client; empty profile (hasLiveScan false) for a fresh client', async () => {
    expect(await getKeywordProfile(999999999)).toBeNull()
    expect(await getKeywordProfile(clientId)).toEqual({
      institutionType: null, programs: [], suggestions: null, locale: null, hasLiveScan: false,
    })
  })
  it('hasLiveScan flips true when a live-scan run exists', async () => {
    await prisma.crawlRun.create({
      data: { tool: 'seo-parser', source: 'live-scan', clientId, status: 'complete' },
    })
    expect((await getKeywordProfile(clientId))!.hasLiveScan).toBe(true)
  })
})

describe('updateKeywordProfile', () => {
  it('sets institutionType, programs, and locale', async () => {
    const r = await updateKeywordProfile(clientId, {
      institutionType: 'trade',
      programs: [{ name: 'Dental Assisting', confirmed: true }],
      locale: { locationCode: 2840, languageCode: 'en', marketLabel: 'United States — English' },
    })
    expect(r.ok).toBe(true)
    const p = await getKeywordProfile(clientId)
    expect(p!.institutionType).toBe('trade')
    expect(p!.programs[0].name).toBe('Dental Assisting')
    expect(p!.locale).toEqual({ locationCode: 2840, languageCode: 'en', marketLabel: 'United States — English' })
  })
  it('clears fields with explicit null', async () => {
    await updateKeywordProfile(clientId, { institutionType: 'trade', locale: { locationCode: 2840, languageCode: 'en' } })
    await updateKeywordProfile(clientId, { institutionType: null, locale: null })
    const p = await getKeywordProfile(clientId)
    expect(p!.institutionType).toBeNull()
    expect(p!.locale).toBeNull()
  })
  it('409-class errors: archived client, unknown suggestion', async () => {
    await prisma.client.update({ where: { id: clientId }, data: { archivedAt: new Date() } })
    expect(await updateKeywordProfile(clientId, { institutionType: 'trade' }))
      .toEqual({ ok: false, error: 'client_archived' })
    await prisma.client.update({ where: { id: clientId }, data: { archivedAt: null } })
    expect(await updateKeywordProfile(clientId, { confirmSuggestion: 'Nope' }))
      .toEqual({ ok: false, error: 'suggestion_not_found' })
  })
  it('confirmSuggestion moves the entry (url copied, source suggested); already-in-roster just drops it', async () => {
    await prisma.client.update({
      where: { id: clientId },
      data: {
        programSuggestionsJson: JSON.stringify({
          v: 1, derivedFromRunId: 'r1', derivedAt: '2026-07-10T00:00:00Z',
          suggestions: [
            { name: 'Cosmetology', url: 'https://x.edu/c', evidence: ['slug'] },
            { name: 'Dental Assisting', evidence: ['schema'] },
          ],
          dismissedNames: [],
        }),
        programsJson: JSON.stringify([{ name: 'dental  assisting', confirmed: true }]),
      },
    })
    const r1 = await updateKeywordProfile(clientId, { confirmSuggestion: 'Cosmetology' })
    expect(r1.ok).toBe(true)
    const p1 = await getKeywordProfile(clientId)
    expect(p1!.programs.find((e) => e.name === 'Cosmetology')).toMatchObject({
      url: 'https://x.edu/c', source: 'suggested', confirmed: true,
    })
    expect(p1!.suggestions!.suggestions.map((s) => s.name)).toEqual(['Dental Assisting'])
    // Already in roster (normalized match) → dropped from suggestions, roster unchanged.
    const before = p1!.programs.length
    await updateKeywordProfile(clientId, { confirmSuggestion: 'Dental Assisting' })
    const p2 = await getKeywordProfile(clientId)
    expect(p2!.programs).toHaveLength(before)
    expect(p2!.suggestions!.suggestions).toEqual([])
  })
  it('dismissSuggestion removes it and records the normalized name', async () => {
    await prisma.client.update({
      where: { id: clientId },
      data: {
        programSuggestionsJson: JSON.stringify({
          v: 1, derivedFromRunId: 'r1', derivedAt: '2026-07-10T00:00:00Z',
          suggestions: [{ name: 'Cosmetology', evidence: ['slug'] }], dismissedNames: [],
        }),
      },
    })
    const r = await updateKeywordProfile(clientId, { dismissSuggestion: 'Cosmetology' })
    expect(r.ok).toBe(true)
    const p = await getKeywordProfile(clientId)
    expect(p!.suggestions!.suggestions).toEqual([])
    expect(p!.suggestions!.dismissedNames).toEqual(['cosmetology'])
  })
})

describe('suggestPrograms', () => {
  it('errors without a live-scan run; unknown client; archived client', async () => {
    expect(await suggestPrograms(999999999)).toEqual({ ok: false, error: 'client_not_found' })
    expect(await suggestPrograms(clientId)).toEqual({ ok: false, error: 'no_live_scan_run' })
    await prisma.client.update({ where: { id: clientId }, data: { archivedAt: new Date() } })
    expect(await suggestPrograms(clientId)).toEqual({ ok: false, error: 'client_archived' })
    await prisma.client.update({ where: { id: clientId }, data: { archivedAt: null } })
  })
  it('derives from the NEWEST live-scan run, persists, preserves dismissedNames, never touches roster', async () => {
    await prisma.client.update({
      where: { id: clientId },
      data: {
        programsJson: JSON.stringify([{ name: 'Kept Program', confirmed: true }]),
        programSuggestionsJson: JSON.stringify({
          v: 1, derivedFromRunId: 'old', derivedAt: '2026-07-01T00:00:00Z',
          suggestions: [], dismissedNames: ['dismissed program'],
        }),
      },
    })
    const old = await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser', source: 'live-scan', clientId, status: 'complete',
        createdAt: new Date('2026-07-01T00:00:00Z'),
      },
    })
    const fresh = await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser', source: 'live-scan', clientId, status: 'complete',
        createdAt: new Date('2026-07-09T00:00:00Z'),
        programEntitiesJson: JSON.stringify({
          v: 1,
          entities: [
            { name: 'Cosmetology', url: 'https://x.edu/c' },
            { name: 'Dismissed Program', url: 'https://x.edu/d' },
          ],
        }),
        pages: {
          create: [{
            url: 'https://x.edu/programs/hvac/', statusCode: 200, indexable: true,
            title: 'HVAC | X', h1: 'HVAC Technician', crawlDepth: 2,
          }],
        },
      },
    })
    void old
    const r = await suggestPrograms(clientId)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.suggestions.derivedFromRunId).toBe(fresh.id)
      expect(r.suggestions.dismissedNames).toEqual(['dismissed program'])
      expect(r.suggestions.suggestions.map((s) => s.name).sort()).toEqual(['Cosmetology', 'HVAC Technician'])
    }
    const p = await getKeywordProfile(clientId)
    expect(p!.programs).toEqual([{ name: 'Kept Program', confirmed: true }])
  })
})
