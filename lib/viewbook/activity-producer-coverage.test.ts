import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const rawSqlProducers = [
  'lib/viewbook/ack.ts',
  'lib/viewbook/answers.ts',
  'lib/viewbook/public-writes.ts',
  'lib/viewbook/service.ts',
  'lib/viewbook/setup.ts',
  'lib/viewbook/team-members.ts',
  'app/api/viewbooks/[id]/team-members/[memberId]/route.ts',
]

describe('ViewbookActivity producer attribution coverage', () => {
  for (const file of rawSqlProducers) {
    it(`${file} binds actorKind in every raw activity insert`, () => {
      const source = readFileSync(file, 'utf8')
      const inserts = [...source.matchAll(/INSERT INTO "ViewbookActivity"\s*\(([^)]+)\)/g)]
      expect(inserts.length, `${file} should remain in the producer worklist`).toBeGreaterThan(0)
      for (const insert of inserts) expect(insert[1]).toContain('"actorKind"')
    })
  }

  it('the shared Prisma producer requires and writes actorKind', () => {
    const source = readFileSync('lib/viewbook/activity.ts', 'utf8')
    expect(source).toMatch(/actorKind:\s*string/)
    expect(source).toMatch(/data:\s*\{[^}]*actorKind/s)
  })
})
