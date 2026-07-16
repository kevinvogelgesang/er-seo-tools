// app/api/issues/route.test.ts
//
// Task 12: GET /api/issues shape test — the route is a thin withRoute wrapper
// over loadIssuesPayload(). No 401 case (middleware doesn't run for a
// directly-imported handler in vitest); the middleware-level "not public"
// assertion lives in middleware.test.ts.
import { describe, it, expect } from 'vitest'
import { GET } from './route'

describe('GET /api/issues', () => {
  it('200s with the IssuesPayload shape', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body).toHaveProperty('sweep')
    expect(body).toHaveProperty('inProgress')
    expect(Array.isArray(body.shortlist)).toBe(true)
    expect(Array.isArray(body.groups)).toBe(true)
    expect(Array.isArray(body.staleGroups)).toBe(true)
    expect(Array.isArray(body.resolvedGroups)).toBe(true)
    expect(Array.isArray(body.notComparable)).toBe(true)

    if (body.sweep !== null) {
      expect(typeof body.sweep.scheduledFor).toBe('string')
      expect(typeof body.sweep.snapshotAt).toBe('string')
      expect(body.sweep).toHaveProperty('startedAt')
      expect(body.sweep).toHaveProperty('totals')
    }
  })
})
