// lib/keywords/volume-config.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { isVolumeEnabled, dataForSeoAuthHeader } from './volume-config'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isVolumeEnabled', () => {
  it('both DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD set → true', () => {
    vi.stubEnv('DATAFORSEO_LOGIN', 'user')
    vi.stubEnv('DATAFORSEO_PASSWORD', 'pass')
    expect(isVolumeEnabled()).toBe(true)
  })

  it('only DATAFORSEO_LOGIN set → false', () => {
    vi.stubEnv('DATAFORSEO_LOGIN', 'user')
    vi.stubEnv('DATAFORSEO_PASSWORD', '')
    expect(isVolumeEnabled()).toBe(false)
  })

  it('only DATAFORSEO_PASSWORD set → false', () => {
    vi.stubEnv('DATAFORSEO_LOGIN', '')
    vi.stubEnv('DATAFORSEO_PASSWORD', 'pass')
    expect(isVolumeEnabled()).toBe(false)
  })

  it('neither set → false', () => {
    vi.stubEnv('DATAFORSEO_LOGIN', '')
    vi.stubEnv('DATAFORSEO_PASSWORD', '')
    expect(isVolumeEnabled()).toBe(false)
  })

  it('empty-string values count as unset → false', () => {
    vi.stubEnv('DATAFORSEO_LOGIN', '')
    vi.stubEnv('DATAFORSEO_PASSWORD', '')
    expect(isVolumeEnabled()).toBe(false)
  })
})

describe('dataForSeoAuthHeader', () => {
  it('builds "Basic " + base64(login:password) when enabled', () => {
    vi.stubEnv('DATAFORSEO_LOGIN', 'l')
    vi.stubEnv('DATAFORSEO_PASSWORD', 'p')
    expect(dataForSeoAuthHeader()).toBe('Basic ' + Buffer.from('l:p').toString('base64'))
  })

  it('throws when disabled', () => {
    vi.stubEnv('DATAFORSEO_LOGIN', '')
    vi.stubEnv('DATAFORSEO_PASSWORD', '')
    expect(() => dataForSeoAuthHeader()).toThrow('volume provider disabled')
  })
})
