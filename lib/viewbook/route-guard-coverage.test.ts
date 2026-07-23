import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const TOKEN_ROUTE_ROOT = 'app/api/viewbook/[token]'
const guardedRoutes = {
  'assets/[filename]/route.ts': 'requireCanRead',
  'sync/route.ts': 'requireCanRead',
  'feedback/route.ts': 'requireCanWrite',
  'materials/route.ts': 'requireCanWrite',
  'answers/route.ts': 'requireCanWrite',
  'ack/route.ts': 'requireCanWrite',
  'team-members/route.ts': 'requireCanWrite',
  'setup/route.ts': 'requireCanWrite',
} as const

describe('viewbook token-route principal guard coverage', () => {
  for (const [relativePath, guard] of Object.entries(guardedRoutes)) {
    it(`${relativePath} calls ${guard} immediately after token resolution`, () => {
      const source = readFileSync(`${TOKEN_ROUTE_ROOT}/${relativePath}`, 'utf8')
      expect(source).toContain(`import { ${guard} } from '@/lib/viewbook/principal'`)
      expect(source).toMatch(
        new RegExp(
          String.raw`(?:const|let)\s+(\w+)\s*=\s*await requireViewbookToken\(token\)\s*;?\s*(?:const principal\s*=\s*)?await ${guard}\(request,\s*\1\)`,
        ),
      )
    })
  }

  it('assets are private and never browser-cached after authorization', () => {
    const source = readFileSync(`${TOKEN_ROUTE_ROOT}/assets/[filename]/route.ts`, 'utf8')
    expect(source).toContain("'Cache-Control': 'private, no-store'")
    expect(source).not.toContain('private, max-age=')
  })
})
