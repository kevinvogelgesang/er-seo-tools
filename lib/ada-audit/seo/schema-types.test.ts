import { describe, expect, it } from 'vitest'
import { aggregateSchemaTypes } from './schema-types'

const row = (types: string[] | null) => ({
  schemaCount: types ? types.length : null,
  detailsJson: types ? JSON.stringify({ schemaTypes: types, hreflang: [] }) : null,
})

describe('aggregateSchemaTypes', () => {
  it('counts pages per type with denominators', () => {
    const out = aggregateSchemaTypes([
      row(['Organization', 'WebPage']),
      row(['Organization']),
      row([]),
      row(null), // unparseable/absent details → observed but schema-less
    ])
    expect(out).toEqual({
      v: 1,
      observedPages: 4,
      pagesWithSchema: 2,
      types: [
        { type: 'Organization', pages: 2 },
        { type: 'WebPage', pages: 1 },
      ],
    })
  })

  it('tolerates malformed detailsJson', () => {
    const out = aggregateSchemaTypes([{ schemaCount: 1, detailsJson: '{not json' }])
    expect(out.observedPages).toBe(1)
    expect(out.pagesWithSchema).toBe(1) // schemaCount scalar is authoritative for the denominator
    expect(out.types).toEqual([])
  })

  it('caps at top 20 types by page count', () => {
    const rows = [row(Array.from({ length: 30 }, (_, i) => `Type${i}`))]
    expect(aggregateSchemaTypes(rows).types).toHaveLength(20)
  })
})
