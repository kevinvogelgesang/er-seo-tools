import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import path from 'path'
import {
  validateTeam,
  validateBlocks,
  validatePcIntro,
  TEAM_CAPS,
  BLOCK_CAPS,
  PC_INTRO_CAP,
  PC_INTRO_DEFAULT,
} from './content-validators'

const roster = [{ name: 'Kevin', role: 'Web Lead', photo: null, blurb: 'Builds the sites.' }]
const blocks = { blocks: [{ heading: 'Our process', body: 'We build fast.' }] }

describe('validateTeam (move-verify: same fixtures as global-content.test.ts)', () => {
  it('accepts a valid roster', () => {
    expect(validateTeam(roster)).toEqual(roster)
  })

  it('rejects a roster over the member cap', () => {
    const fatRoster = Array.from({ length: 21 }, (_, i) => ({ name: `P${i}`, role: 'x', photo: null, blurb: '' }))
    expect(validateTeam(fatRoster)).toBeNull()
    expect(TEAM_CAPS.members).toBe(20)
  })

  it('rejects an unknown roster key', () => {
    expect(validateTeam([{ ...roster[0], unknown: true }])).toBeNull()
  })

  it('rejects a photo filename failing ASSET_FILENAME_RE', () => {
    expect(validateTeam([{ ...roster[0], photo: 'not-an-asset' }])).toBeNull()
    expect(validateTeam([{ ...roster[0], photo: 'kevin.png' }])).toEqual([{ ...roster[0], photo: 'kevin.png' }])
  })

  it('requires unique team member names', () => {
    const dup = [...roster, { name: 'Kevin', role: 'Other', photo: null, blurb: '' }]
    expect(validateTeam(dup)).toBeNull()
  })

  it('accepts optional CSM metadata and canonicalizes email', () => {
    const enriched = [{
      name: 'Kevin', role: 'CSM', photo: null, blurb: 'Helps clients.',
      isCsm: true, email: ' Kevin.Vogel@Example.COM ',
    }]
    expect(validateTeam(enriched)).toEqual([{ ...enriched[0], email: 'kevin.vogel@example.com' }])
  })

  it('rejects malformed optional CSM metadata', () => {
    expect(validateTeam([{ ...roster[0], isCsm: 'yes' }])).toBeNull()
    for (const email of ['Name <name@example.com>', 'a@example.com,b@example.com', 'not-an-email']) {
      expect(validateTeam([{ ...roster[0], email }])).toBeNull()
    }
  })
})

describe('validateBlocks (move-verify: same fixtures as global-content.test.ts)', () => {
  it('accepts valid blocks', () => {
    expect(validateBlocks(blocks)).toEqual(blocks)
  })

  it('rejects blocks with an extra key', () => {
    expect(validateBlocks(roster)).toBeNull()
    expect(validateBlocks({ blocks: [{ heading: 'h', body: 'b', extra: 1 }] })).toBeNull()
  })

  it('enforces the body cap', () => {
    expect(validateBlocks({ blocks: [{ heading: 'h', body: 'a'.repeat(4097) }] })).toBeNull()
    expect(BLOCK_CAPS.body).toBe(4096)
  })
})

describe('validatePcIntro (move-verify: same fixtures as global-content.test.ts)', () => {
  it('accepts a bounded non-empty string; rejects empty and oversize', () => {
    expect(validatePcIntro('Welcome to your viewbook!')).toBe('Welcome to your viewbook!')
    expect(validatePcIntro('')).toBeNull()
    expect(validatePcIntro(123)).toBeNull()
    expect(validatePcIntro(['not a string'])).toBeNull()
    expect(validatePcIntro('a'.repeat(2001))).toBeNull()
    expect(PC_INTRO_CAP).toBe(2000)
  })
})

describe('PC_INTRO_DEFAULT', () => {
  it('matches the exact fallback string PcIntroSection.tsx used to own locally', () => {
    expect(PC_INTRO_DEFAULT).toBe(
      "Welcome! Let's get your viewbook set up — a few quick basics, then invite your team so everyone can follow along.",
    )
  })
})

describe('client-safety', () => {
  it('imports only ./theme + ./global-content-keys (+ types) — never @/lib/db, @prisma/client, or server-only modules', async () => {
    const source = await readFile(path.join(__dirname, 'content-validators.ts'), 'utf8')
    const importLines = source.match(/^import .+$/gm) ?? []
    expect(importLines.length).toBeGreaterThan(0)
    for (const line of importLines) {
      expect(line).not.toMatch(/@\/lib\/db/)
      expect(line).not.toMatch(/@prisma\/client/)
      expect(line).not.toMatch(/HttpError/)
      expect(line).not.toMatch(/['"]\.\/sync['"]/)
      expect(line).toMatch(/from '\.\/(theme|global-content-keys)'/)
    }
  })
})
