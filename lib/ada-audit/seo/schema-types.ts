// C14: aggregate JSON-LD @type histogram across harvested pages, computed by
// the live-scan builder BEFORE the transient HarvestedPageSeo rows are
// deleted. Durable home: CrawlRun.schemaTypesJson.

export interface SchemaTypesSummary {
  v: 1
  observedPages: number
  pagesWithSchema: number
  types: { type: string; pages: number }[]
}

const MAX_TYPES = 20

export function aggregateSchemaTypes(
  rows: { schemaCount: number | null; detailsJson: string | null }[],
): SchemaTypesSummary {
  const counts = new Map<string, number>()
  let pagesWithSchema = 0
  for (const r of rows) {
    if ((r.schemaCount ?? 0) > 0) pagesWithSchema++
    if (!r.detailsJson) continue
    let types: unknown
    try {
      types = (JSON.parse(r.detailsJson) as { schemaTypes?: unknown }).schemaTypes
    } catch {
      continue
    }
    if (!Array.isArray(types)) continue
    for (const t of new Set(types.filter((x): x is string => typeof x === 'string'))) {
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }
  const types = [...counts.entries()]
    .map(([type, pages]) => ({ type, pages }))
    .sort((a, b) => b.pages - a.pages || a.type.localeCompare(b.type))
    .slice(0, MAX_TYPES)
  return { v: 1, observedPages: rows.length, pagesWithSchema, types }
}
