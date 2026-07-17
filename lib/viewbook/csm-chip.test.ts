import { describe, expect, it } from 'vitest'
import type { TeamMember } from './global-content-keys'
import { resolveCsmChip } from './csm-chip'

const team: TeamMember[] = [
  { name: 'Pat', role: 'CSM', photo: 'p.webp', isCsm: true, email: 'pat@er.com', blurb: '' },
]

describe('resolveCsmChip', () => {
  it('matches the roster member where isCsm is true and name equals csmName', () => {
    expect(resolveCsmChip(team, 'Pat')).toEqual({
      name: 'Pat',
      role: 'CSM',
      photo: 'p.webp',
      email: 'pat@er.com',
    })
  })

  it('returns null when the roster is null', () => {
    expect(resolveCsmChip(null, 'Pat')).toBeNull()
  })

  it('returns null when the roster is undefined', () => {
    expect(resolveCsmChip(undefined, 'Pat')).toBeNull()
  })

  it('returns null when the matching member is not flagged isCsm', () => {
    expect(
      resolveCsmChip([{ name: 'Pat', role: 'x', photo: null, isCsm: false, blurb: '' }], 'Pat'),
    ).toBeNull()
  })

  it('returns null when csmName is null', () => {
    expect(resolveCsmChip(team, null)).toBeNull()
  })

  it('returns null when no roster member matches the name', () => {
    expect(resolveCsmChip(team, 'Someone Else')).toBeNull()
  })

  it('defaults email to null when the matched member has no email', () => {
    const noEmailTeam: TeamMember[] = [
      { name: 'Sam', role: 'CSM', photo: null, isCsm: true, blurb: '' },
    ]
    expect(resolveCsmChip(noEmailTeam, 'Sam')).toEqual({
      name: 'Sam',
      role: 'CSM',
      photo: null,
      email: null,
    })
  })
})
