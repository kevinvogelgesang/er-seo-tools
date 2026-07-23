import { describe, it, expect } from 'vitest'
import { extractInstanceAssetRefs } from './instance-asset-refs'

const roster = JSON.stringify({ v: 1, team: [
  { name: 'A', role: 'CSM', photo: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp', blurb: '' },
  { name: 'B', role: 'Dev', photo: null, blurb: '' },
  { name: 'C', role: 'PM', photo: '../etc/passwd', blurb: '' },
], process: { blocks: [] }, why: { blocks: [] } })

describe('extractInstanceAssetRefs', () => {
  it('extracts valid roster photo filenames from welcome content', () =>
    expect(extractInstanceAssetRefs('welcome', roster)).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp']))
  it('returns [] for corrupt JSON / null / other renderer types', () => {
    expect(extractInstanceAssetRefs('welcome', '{nope')).toEqual([])
    expect(extractInstanceAssetRefs('welcome', null)).toEqual([])
    expect(extractInstanceAssetRefs('strategy', roster)).toEqual([])
  })
})
