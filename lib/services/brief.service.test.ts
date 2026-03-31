import { describe, it, expect } from 'vitest'
import {
  parseScreamingFrogInternal,
  parseScreamingFrogStructuredData,
  parseSemrushKeywords,
  generateBrief,
} from './brief.service'

// ---------------------------------------------------------------------------
// Shared type shapes (mirror the private interfaces in brief.service.ts)
// ---------------------------------------------------------------------------

type Page = {
  url: string
  title: string
  statusCode: number
  indexability: string
  wordCount: number
  inlinks: number
  h1: string
  metaDesc: string
}

type SchemaEntry = {
  url: string
  schemaType: string
}

type Keyword = {
  keyword: string
  volume: number
  position: number
  difficulty: number
  intent: string
  url: string
  cpc: number
}

// ---------------------------------------------------------------------------
// CSV fixtures
// ---------------------------------------------------------------------------

const SF_INTERNAL_CSV = `Address,Title 1,Status Code,Indexability,Word Count,Inlinks,H1-1,Meta Description 1
https://example.com/,Home Page,200,Indexable,1200,45,Welcome Home,The home meta description
https://example.com/nursing-program,Nursing Program,200,Indexable,800,20,Our Nursing Program,Become a nurse
https://example.com/404-page,Not Found,404,Non-Indexable,0,0,,
https://example.com/about,About Us,200,Indexable,500,10,About Our School,Learn about us
`

const SF_INTERNAL_CSV_EMPTY = `Address,Title 1,Status Code,Indexability,Word Count,Inlinks,H1-1,Meta Description 1
`

const SF_INTERNAL_CSV_MINIMAL = `Address,Title 1,Status Code,Indexability,Word Count,Inlinks,H1-1,Meta Description 1
https://example.com/,Home,200,Indexable,100,0,,
`

const SF_STRUCTURED_CSV = `Address,Schema Type
https://example.com/nursing-program,FAQPage
https://example.com/about,Organization
https://example.com/,WebSite
`

const SF_STRUCTURED_CSV_MULTI_TYPE = `Address,Type 1,Type 2
https://example.com/page1,FAQPage,BreadcrumbList
https://example.com/page2,Organization,
`

const SF_STRUCTURED_CSV_EMPTY = `Address,Schema Type
`

const SEMRUSH_KEYWORD_CSV = `Keyword,Search Volume,Keyword Difficulty,CPC,Position,URL,Intents
nursing school near me,5400,45,2.50,3,https://example.com/nursing-program,i
best nursing programs,2900,60,1.80,15,https://example.com/nursing-program,i|c
online nursing degree,1200,55,3.10,25,https://example.com/online-nursing,c
dental assistant program,800,40,1.20,0,https://example.com/dental-program,i
`

const SEMRUSH_KEYWORD_CSV_EMPTY = `Keyword,Search Volume,Keyword Difficulty,CPC,Position,URL,Intents
`

// ---------------------------------------------------------------------------
// parseScreamingFrogInternal
// ---------------------------------------------------------------------------

describe('parseScreamingFrogInternal', () => {
  it('parses a valid SF internal CSV and returns pages', () => {
    const { pages } = parseScreamingFrogInternal(SF_INTERNAL_CSV)
    // Only rows starting with http are included; 404 is still included (filter is on startsWith http)
    const urls = pages.map(p => p.url)
    expect(urls).toContain('https://example.com/')
    expect(urls).toContain('https://example.com/nursing-program')
    expect(urls).toContain('https://example.com/about')
  })

  it('maps title, statusCode, indexability, wordCount, inlinks fields correctly', () => {
    const { pages } = parseScreamingFrogInternal(SF_INTERNAL_CSV)
    const home = pages.find(p => p.url === 'https://example.com/')
    expect(home).not.toBeUndefined()
    expect(home!.title).toBe('Home Page')
    expect(home!.statusCode).toBe(200)
    expect(home!.indexability).toBe('Indexable')
    expect(home!.wordCount).toBe(1200)
    expect(home!.inlinks).toBe(45)
    expect(home!.h1).toBe('Welcome Home')
    expect(home!.metaDesc).toBe('The home meta description')
  })

  it('returns empty pages array for empty CSV (header only)', () => {
    const { pages } = parseScreamingFrogInternal(SF_INTERNAL_CSV_EMPTY)
    expect(pages).toHaveLength(0)
  })

  it('handles minimal single-row CSV', () => {
    const { pages } = parseScreamingFrogInternal(SF_INTERNAL_CSV_MINIMAL)
    expect(pages).toHaveLength(1)
    expect(pages[0].url).toBe('https://example.com/')
  })

  it('ignores rows where address does not start with http', () => {
    const csv = `Address,Title 1,Status Code,Indexability,Word Count,Inlinks,H1-1,Meta Description 1
not-a-url,Bad Row,200,Indexable,0,0,,
https://example.com/,Good Row,200,Indexable,100,0,,
`
    const { pages } = parseScreamingFrogInternal(csv)
    expect(pages).toHaveLength(1)
    expect(pages[0].url).toBe('https://example.com/')
  })

  it('handles completely empty content gracefully', () => {
    const { pages } = parseScreamingFrogInternal('')
    expect(Array.isArray(pages)).toBe(true)
    expect(pages).toHaveLength(0)
  })

  it('accepts alternate column name "url" in addition to "address"', () => {
    const csv = `url,Title 1,Status Code,Indexability,Word Count,Inlinks,H1-1,Meta Description 1
https://example.com/alt,Alt Title,200,Indexable,300,5,,
`
    const { pages } = parseScreamingFrogInternal(csv)
    expect(pages).toHaveLength(1)
    expect(pages[0].url).toBe('https://example.com/alt')
  })
})

// ---------------------------------------------------------------------------
// parseScreamingFrogStructuredData
// ---------------------------------------------------------------------------

describe('parseScreamingFrogStructuredData', () => {
  it('parses schema type from "Schema Type" column', () => {
    const { schema } = parseScreamingFrogStructuredData(SF_STRUCTURED_CSV)
    expect(schema).toHaveLength(3)
    const faqEntry = schema.find(s => s.url === 'https://example.com/nursing-program')
    expect(faqEntry?.schemaType).toBe('FAQPage')
  })

  it('returns empty schema array for empty CSV', () => {
    const { schema } = parseScreamingFrogStructuredData(SF_STRUCTURED_CSV_EMPTY)
    expect(schema).toHaveLength(0)
  })

  it('handles multi-type columns (Type 1, Type 2, …) correctly', () => {
    const { schema } = parseScreamingFrogStructuredData(SF_STRUCTURED_CSV_MULTI_TYPE)
    const page1Entries = schema.filter(s => s.url === 'https://example.com/page1')
    expect(page1Entries).toHaveLength(2)
    const types = page1Entries.map(e => e.schemaType)
    expect(types).toContain('FAQPage')
    expect(types).toContain('BreadcrumbList')
  })

  it('skips rows with no URL', () => {
    const csv = `Address,Schema Type
,FAQPage
https://example.com/page,Organization
`
    const { schema } = parseScreamingFrogStructuredData(csv)
    expect(schema).toHaveLength(1)
    expect(schema[0].url).toBe('https://example.com/page')
  })

  it('handles completely empty content gracefully', () => {
    const { schema } = parseScreamingFrogStructuredData('')
    expect(Array.isArray(schema)).toBe(true)
    expect(schema).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// parseSemrushKeywords
// ---------------------------------------------------------------------------

describe('parseSemrushKeywords', () => {
  it('parses keyword research CSV and returns keywords', () => {
    const { keywords, type } = parseSemrushKeywords(SEMRUSH_KEYWORD_CSV)
    expect(keywords).toHaveLength(4)
    // The fixture has a "Position" column — the parser treats any column named
    // "position" (case-insensitive) as a position-tracking export.
    expect(type).toBe('position_tracking')
    const kw = keywords.find(k => k.keyword === 'nursing school near me')
    expect(kw).toBeDefined()
    expect(kw!.volume).toBe(5400)
    expect(kw!.position).toBe(3)
    expect(kw!.difficulty).toBe(45)
    expect(kw!.cpc).toBeCloseTo(2.5)
  })

  it('normalizes intent codes to full words', () => {
    const { keywords } = parseSemrushKeywords(SEMRUSH_KEYWORD_CSV)
    const kw = keywords.find(k => k.keyword === 'nursing school near me')
    expect(kw!.intent).toBe('informational')
  })

  it('uses first intent when pipe-separated intents are provided', () => {
    const { keywords } = parseSemrushKeywords(SEMRUSH_KEYWORD_CSV)
    const kw = keywords.find(k => k.keyword === 'best nursing programs')
    // "i|c" → first token is "i" → informational
    expect(kw!.intent).toBe('informational')
  })

  it('returns empty keywords and type "empty" for CSV with no data rows', () => {
    const { keywords, type } = parseSemrushKeywords(SEMRUSH_KEYWORD_CSV_EMPTY)
    expect(keywords).toHaveLength(0)
    expect(type).toBe('empty')
  })

  it('handles completely empty content gracefully', () => {
    const { keywords } = parseSemrushKeywords('')
    expect(Array.isArray(keywords)).toBe(true)
  })

  it('detects position tracking format via date-stamped column', () => {
    const ptCsv = [
      'Keyword,example.com_20240101,example.com_20240101_landing,Search Volume',
      'nursing program,5,,2000',
    ].join('\n')
    const { type } = parseSemrushKeywords(ptCsv)
    expect(type).toBe('position_tracking')
  })

  it('returns keyword_research type when no position column present', () => {
    const kwCsv = [
      'Keyword,Search Volume,Keyword Difficulty,CPC,Intents,URL',
      'nursing school,5400,45,2.50,i,https://example.com/nursing',
    ].join('\n')
    const { type } = parseSemrushKeywords(kwCsv)
    expect(type).toBe('keyword_research')
  })

  it('parses zero-position keywords (not ranking)', () => {
    const { keywords } = parseSemrushKeywords(SEMRUSH_KEYWORD_CSV)
    const kw = keywords.find(k => k.keyword === 'dental assistant program')
    expect(kw!.position).toBe(0)
  })

  it('handles keywords with Volume=0 or blank volume without crashing or inflating volume stats', () => {
    const csvWithZeroVolume = `Keyword,Search Volume,Keyword Difficulty,CPC,Position,URL,Intents
keyword with zero volume,0,30,1.00,5,https://example.com/page,i
keyword with blank volume,,25,0.50,10,https://example.com/page2,c
normal keyword,500,40,2.00,3,https://example.com/page3,i
`
    const { keywords } = parseSemrushKeywords(csvWithZeroVolume)
    // Should not crash and should include all three keywords
    expect(keywords).toHaveLength(3)

    const zeroVol = keywords.find(k => k.keyword === 'keyword with zero volume')
    expect(zeroVol).not.toBeUndefined()
    expect(zeroVol!.volume).toBe(0)

    const blankVol = keywords.find(k => k.keyword === 'keyword with blank volume')
    expect(blankVol).not.toBeUndefined()
    expect(blankVol!.volume).toBe(0)

    // The zero/blank volume keywords should be excluded from keyword categories
    // (categorizeKeywords skips volume < 10), so only the normal keyword counts
    const { brief } = generateBrief('Test', [], [], keywords)
    // Only the normal keyword (volume=500, position=3) falls in winning
    expect(brief).toContain('Winning (1-10):** 1 keywords')
  })
})

// ---------------------------------------------------------------------------
// generateBrief
// ---------------------------------------------------------------------------

const samplePages: Page[] = [
  {
    url: 'https://example.com/',
    title: 'Home',
    statusCode: 200,
    indexability: 'Indexable',
    wordCount: 1000,
    inlinks: 50,
    h1: 'Welcome',
    metaDesc: 'Home description',
  },
  {
    url: 'https://example.com/nursing-program',
    title: 'Nursing Program',
    statusCode: 200,
    indexability: 'Indexable',
    wordCount: 900,
    inlinks: 20,
    h1: 'Our Nursing Program',
    metaDesc: 'Become a nurse',
  },
  {
    url: 'https://example.com/about',
    title: 'About Us',
    statusCode: 200,
    indexability: 'Indexable',
    wordCount: 400,
    inlinks: 8,
    h1: 'About',
    metaDesc: 'About us',
  },
]

const sampleSchema: SchemaEntry[] = [
  { url: 'https://example.com/nursing-program', schemaType: 'FAQPage' },
  { url: 'https://example.com/', schemaType: 'WebSite' },
]

const sampleKeywords: Keyword[] = [
  { keyword: 'nursing school', volume: 5400, position: 3, difficulty: 45, intent: 'informational', url: 'https://example.com/nursing-program', cpc: 2.5 },
  { keyword: 'best nursing program', volume: 2900, position: 15, difficulty: 60, intent: 'commercial', url: 'https://example.com/nursing-program', cpc: 1.8 },
  { keyword: 'online nursing degree', volume: 1200, position: 25, difficulty: 55, intent: 'commercial', url: 'https://example.com/online-nursing', cpc: 3.1 },
  { keyword: 'nursing assistant certification', volume: 800, position: 0, difficulty: 40, intent: 'informational', url: '', cpc: 0 },
]

describe('generateBrief', () => {
  it('returns a BriefResult with brief string and stats', () => {
    const result = generateBrief('Test College', samplePages, sampleSchema, sampleKeywords)
    expect(typeof result.brief).toBe('string')
    expect(result.brief.length).toBeGreaterThan(0)
    expect(result.stats.pages).toBe(samplePages.length)
    expect(result.stats.schemaEntries).toBe(sampleSchema.length)
    expect(result.stats.keywords).toBe(sampleKeywords.length)
    expect(result.stats.outputChars).toBe(result.brief.length)
    expect(result.stats.estimatedTokens).toBe(Math.ceil(result.brief.length / 4))
  })

  it('brief contains the client name in the heading', () => {
    const { brief } = generateBrief('Acme University', samplePages, sampleSchema, sampleKeywords)
    expect(brief).toContain('Acme University')
    expect(brief).toContain('# SEO Data Brief:')
  })

  it('brief includes Site Structure section', () => {
    const { brief } = generateBrief('Test', samplePages, sampleSchema, sampleKeywords)
    expect(brief).toContain('## Site Structure')
  })

  it('brief includes Schema Coverage section', () => {
    const { brief } = generateBrief('Test', samplePages, sampleSchema, sampleKeywords)
    expect(brief).toContain('## Schema Coverage')
  })

  it('brief includes Keyword Performance section', () => {
    const { brief } = generateBrief('Test', samplePages, sampleSchema, sampleKeywords)
    expect(brief).toContain('## Keyword Performance')
  })

  it('brief includes Analysis Request section', () => {
    const { brief } = generateBrief('Test', samplePages, sampleSchema, sampleKeywords)
    expect(brief).toContain('## Analysis Request')
  })

  it('brief shows correct total pages count', () => {
    const { brief } = generateBrief('Test', samplePages, sampleSchema, sampleKeywords)
    expect(brief).toContain(`Total pages crawled:** ${samplePages.length}`)
  })

  it('identifies program pages in site structure', () => {
    const { brief } = generateBrief('Test', samplePages, sampleSchema, sampleKeywords)
    // nursing-program should be identified
    expect(brief).toContain('Program Pages')
  })

  it('shows FAQ schema pages when present', () => {
    const { brief } = generateBrief('Test', samplePages, sampleSchema, sampleKeywords)
    expect(brief).toContain('FAQ')
  })

  it('shows keyword categories when keywords are provided', () => {
    const { brief } = generateBrief('Test', samplePages, sampleSchema, sampleKeywords)
    expect(brief).toContain('Winning')
    expect(brief).toContain('Opportunity')
    expect(brief).toContain('Striking Distance')
  })

  it('handles empty pages array gracefully', () => {
    const result = generateBrief('Empty College', [], sampleSchema, sampleKeywords)
    expect(result.brief).toContain('No crawl data provided')
    expect(result.stats.pages).toBe(0)
  })

  it('handles empty schema array gracefully', () => {
    const result = generateBrief('Empty College', samplePages, [], sampleKeywords)
    expect(result.brief).toContain('No structured data export provided')
    expect(result.stats.schemaEntries).toBe(0)
  })

  it('handles empty keywords array gracefully', () => {
    const result = generateBrief('Empty College', samplePages, sampleSchema, [])
    expect(result.brief).toContain('No keyword data provided')
    expect(result.stats.keywords).toBe(0)
  })

  it('handles all-empty arrays without throwing', () => {
    expect(() => generateBrief('Empty', [], [], [])).not.toThrow()
    const result = generateBrief('Empty', [], [], [])
    expect(result.stats.pages).toBe(0)
    expect(result.stats.keywords).toBe(0)
    expect(result.stats.schemaEntries).toBe(0)
  })

  it('estimatedTokens is roughly brief.length / 4', () => {
    const result = generateBrief('Test', samplePages, sampleSchema, sampleKeywords)
    expect(result.stats.estimatedTokens).toBe(Math.ceil(result.brief.length / 4))
  })

  it('excludes keywords with volume < 10 from category counts', () => {
    const lowVolKws: Keyword[] = [
      { keyword: 'high volume win', volume: 1000, position: 5, difficulty: 30, intent: 'informational', url: '', cpc: 0 },
      { keyword: 'tiny volume', volume: 5, position: 5, difficulty: 10, intent: 'informational', url: '', cpc: 0 },
    ]
    const { brief } = generateBrief('Test', [], [], lowVolKws)
    // Winning section should exist and show 1 keyword (tiny volume excluded)
    expect(brief).toContain('Winning (1-10):** 1 keywords')
  })

  it('shows winning keywords table with correct columns', () => {
    const { brief } = generateBrief('Test', samplePages, sampleSchema, sampleKeywords)
    expect(brief).toContain('| Keyword | Pos | Volume | Intent |')
  })

  it('shows gaps table with difficulty column', () => {
    const { brief } = generateBrief('Test', samplePages, sampleSchema, sampleKeywords)
    expect(brief).toContain('| Keyword | Volume | Difficulty | Intent |')
  })

  it('only indexable pages count toward program page identification', () => {
    const mixedPages: Page[] = [
      {
        url: 'https://example.com/nursing-program',
        title: 'Nursing Program',
        statusCode: 200,
        indexability: 'Indexable',
        wordCount: 900,
        inlinks: 20,
        h1: 'Our Nursing Program',
        metaDesc: 'Become a nurse',
      },
      {
        url: 'https://example.com/dental-program',
        title: 'Dental Program',
        statusCode: 200,
        indexability: 'Non-Indexable',
        wordCount: 800,
        inlinks: 15,
        h1: 'Dental',
        metaDesc: 'Dental assistant',
      },
      {
        url: 'https://example.com/404-program',
        title: '404 Nursing Program',
        statusCode: 404,
        indexability: 'Indexable',
        wordCount: 0,
        inlinks: 0,
        h1: '',
        metaDesc: '',
      },
    ]
    // Total crawled = 3, but indexable (status < 400 and not Non-Indexable) = 1
    const { brief } = generateBrief('Test College', mixedPages, [], [])
    // Total pages crawled reflects all 3 pages
    expect(brief).toContain('Total pages crawled:** 3')
    // Only 1 page is truly indexable (200 + Indexable)
    expect(brief).toContain('Indexable pages:** 1')
    // Only the 200+Indexable nursing-program page qualifies as a program page
    expect(brief).toContain('Program pages identified:** 1')
  })

  it('stats.outputChars is at least 100 chars when data is non-empty', () => {
    const result = generateBrief('Test', samplePages, sampleSchema, sampleKeywords)
    expect(result.stats.outputChars).toBeGreaterThan(100)
  })

  it('stats.estimatedTokens equals Math.ceil(stats.outputChars / 4)', () => {
    const result = generateBrief('Test', samplePages, sampleSchema, sampleKeywords)
    expect(result.stats.estimatedTokens).toBe(Math.ceil(result.stats.outputChars / 4))
  })
})
