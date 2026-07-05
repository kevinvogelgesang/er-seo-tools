import { describe, it, expect } from 'vitest'
import { HttpError } from './errors'
it('carries status + code', () => {
  const e = new HttpError(409, 'conflict')
  expect(e.status).toBe(409)
  expect(e.code).toBe('conflict')
  expect(e).toBeInstanceOf(Error)
})
