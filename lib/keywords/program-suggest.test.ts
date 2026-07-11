import { describe, it, expect } from 'vitest'
import { cleanHeading, deriveProgramSuggestions } from './program-suggest'

const page = (url: string, over: Partial<Parameters<typeof deriveProgramSuggestions>[0]['pages'][number]> = {}) => ({
  url, title: null, h1: null, statusCode: 200, indexable: true, crawlDepth: 2, ...over,
})
const derive = (over: Partial<Parameters<typeof deriveProgramSuggestions>[0]>) =>
  deriveProgramSuggestions({ pages: [], programEntities: [], confirmedNames: [], dismissedNames: [], ...over })

describe('cleanHeading', () => {
  it('strips the site-name suffix after the last separator and collapses whitespace', () => {
    expect(cleanHeading('Dental  Assisting | Bellus Academy')).toBe('Dental Assisting')
    expect(cleanHeading('HVAC – Programs – Foo College')).toBe('HVAC – Programs')
    expect(cleanHeading('Plain Heading')).toBe('Plain Heading')
  })
})

describe('deriveProgramSuggestions', () => {
  it('suggests program-slug pages named by H1, falling back to title', () => {
    const out = derive({
      pages: [
        page('https://x.edu/programs/dental-assisting/', { h1: 'Dental Assisting' }),
        page('https://x.edu/programs/hvac/', { title: 'HVAC Technician | X College' }),
      ],
    })
    expect(out).toEqual([
      { name: 'Dental Assisting', url: 'https://x.edu/programs/dental-assisting/', evidence: ['slug'] },
      { name: 'HVAC Technician', url: 'https://x.edu/programs/hvac/', evidence: ['slug'] },
    ])
  })
  it('excludes non-program pages, non-2xx, non-indexable, and sub-3-char names', () => {
    const out = derive({
      pages: [
        page('https://x.edu/blog/post/', { h1: 'A Blog Post' }),
        page('https://x.edu/programs/a/', { h1: 'Gone', statusCode: 404 }),
        page('https://x.edu/programs/b/', { h1: 'Hidden', indexable: false }),
        page('https://x.edu/programs/c/', { h1: 'Ab' }),
      ],
    })
    expect(out).toEqual([])
  })
  it('merges schema entities by normalized name, unioning evidence, slug URL kept (processed first)', () => {
    const out = derive({
      pages: [page('https://x.edu/programs/dental-assisting/', { h1: 'Dental Assisting' })],
      programEntities: [
        { name: 'dental  assisting', url: 'https://x.edu/other' },
        { name: 'Cosmetology', url: 'https://x.edu/programs/cosmo/' },
      ],
    })
    expect(out).toEqual([
      { name: 'Dental Assisting', url: 'https://x.edu/programs/dental-assisting/', evidence: ['slug', 'schema'] },
      { name: 'Cosmetology', url: 'https://x.edu/programs/cosmo/', evidence: ['schema'] },
    ])
  })
  it('excludes confirmed and dismissed names (normalized match)', () => {
    const out = derive({
      pages: [page('https://x.edu/programs/da/', { h1: 'Dental Assisting' })],
      programEntities: [{ name: 'Cosmetology', url: 'https://x.edu/c' }],
      confirmedNames: ['dental assisting'],
      dismissedNames: ['cosmetology'],
    })
    expect(out).toEqual([])
  })
  it('ranks two-evidence suggestions first, then alphabetical, capped at 40', () => {
    const pages = [page('https://x.edu/programs/zz/', { h1: 'ZZ Prog' })]
    const entities = [
      { name: 'ZZ Prog', url: 'https://x.edu/z' },
      ...Array.from({ length: 45 }, (_, i) => ({ name: `Prog ${String(i).padStart(2, '0')}`, url: `https://x.edu/p${i}` })),
    ]
    const out = derive({ pages, programEntities: entities })
    expect(out[0].name).toBe('ZZ Prog')
    expect(out[0].evidence).toEqual(['slug', 'schema'])
    expect(out).toHaveLength(40)
  })
})
