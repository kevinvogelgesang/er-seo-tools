import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { resolveOperatorIdentity, IdentityError } from './identity'

const SUB_PREFIX = 'oauth-test-sub-'
const opts = { allowedHd: 'enrollmentresources.com' }
const verified = {
  sub: `${SUB_PREFIX}1`,
  email: 'oauthtest@enrollmentresources.com',
  emailVerified: true,
  hd: 'enrollmentresources.com',
  name: 'OAuth Tester',
}

async function clear() {
  await prisma.user.deleteMany({ where: { googleSub: { startsWith: SUB_PREFIX } } })
}
beforeEach(clear)
afterAll(clear)

describe('resolveOperatorIdentity', () => {
  it('creates an active user and returns the session identity', async () => {
    const identity = await resolveOperatorIdentity(verified, opts)
    expect(identity).toEqual({
      sub: `google:${SUB_PREFIX}1`,
      email: 'oauthtest@enrollmentresources.com',
      hd: 'enrollmentresources.com',
      name: 'OAuth Tester',
    })
    const row = await prisma.user.findUnique({ where: { googleSub: `${SUB_PREFIX}1` } })
    expect(row?.active).toBe(true)
    expect(row?.lastLoginAt).not.toBeNull()
  })

  it('is idempotent — second login updates the same row, no duplicate', async () => {
    await resolveOperatorIdentity(verified, opts)
    await resolveOperatorIdentity({ ...verified, name: 'Renamed' }, opts)
    const rows = await prisma.user.findMany({ where: { googleSub: `${SUB_PREFIX}1` } })
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Renamed')
  })

  it('rejects an unverified email', async () => {
    await expect(resolveOperatorIdentity({ ...verified, emailVerified: false }, opts)).rejects.toBeInstanceOf(IdentityError)
  })

  it('rejects a hosted-domain mismatch', async () => {
    await expect(resolveOperatorIdentity({ ...verified, hd: 'evil.com' }, opts)).rejects.toBeInstanceOf(IdentityError)
  })

  it('rejects an email outside the allowed domain even if hd matches', async () => {
    await expect(
      resolveOperatorIdentity({ ...verified, email: 'attacker@evil.com' }, opts),
    ).rejects.toBeInstanceOf(IdentityError)
  })

  it('rejects a deactivated user', async () => {
    await resolveOperatorIdentity(verified, opts) // creates active
    await prisma.user.update({ where: { googleSub: `${SUB_PREFIX}1` }, data: { active: false } })
    await expect(resolveOperatorIdentity(verified, opts)).rejects.toBeInstanceOf(IdentityError)
  })
})
