// KS-3: aggregate JSON-LD program entities ({name, url}) across harvested
// pages, computed by the live-scan builder BEFORE the transient
// HarvestedPageSeo rows are deleted (schemaTypesJson C14 precedent).
// Durable home: CrawlRun.programEntitiesJson. The CALLER pre-filters rows to
// indexable ∧ ¬login-like (same posture as computeContentSimilarity).
// url = the harvested (audited) page URL — JSON-LD Course.url is NOT captured
// in v1 (KS3-Codex #3).

export interface ProgramEntity {
  name: string
  url: string
}

export interface ProgramEntitiesSummary {
  v: 1
  entities: ProgramEntity[]
}

const MAX_ENTITIES = 100

export function aggregateProgramEntities(
  rows: { url: string; detailsJson: string | null }[],
): ProgramEntitiesSummary | null {
  const pairs: ProgramEntity[] = []
  for (const r of rows) {
    if (!r.detailsJson) continue
    let names: unknown
    try {
      names = (JSON.parse(r.detailsJson) as { programNames?: unknown }).programNames
    } catch {
      continue
    }
    if (!Array.isArray(names)) continue
    for (const n of names) {
      if (typeof n === 'string' && n.trim()) pairs.push({ name: n, url: r.url })
    }
  }
  if (pairs.length === 0) return null
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  // Deterministic winner: sort by (normalized name, url), keep-first per name.
  pairs.sort((a, b) => norm(a.name).localeCompare(norm(b.name)) || a.url.localeCompare(b.url))
  const seen = new Set<string>()
  const entities: ProgramEntity[] = []
  for (const p of pairs) {
    const k = norm(p.name)
    if (seen.has(k)) continue
    seen.add(k)
    entities.push(p)
    if (entities.length >= MAX_ENTITIES) break
  }
  return { v: 1, entities }
}
