// The ONE fail-closed public-token validator for /viewbook/[token] surfaces
// (spec §7). Every failure — unknown token, revoked viewbook, archived
// client — is the SAME controlled 404 (no oracle distinguishing them), never
// a raw throw. PR2 (page + assets route), PR4 (feedback/materials), and PR3
// (answers) all import this unchanged; it is only a PREFLIGHT — every public
// mutation must ALSO re-verify these conditions inside its own conditional
// write (commit-time fencing, spec §7).

import type { Viewbook } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'

export async function requireViewbookToken(token: string): Promise<Viewbook> {
  if (!token || token.length > 128) throw new HttpError(404, 'not_found')
  const vb = await prisma.viewbook.findUnique({
    where: { token },
    include: { client: { select: { archivedAt: true } } },
  })
  if (!vb || vb.revokedAt || vb.client.archivedAt) throw new HttpError(404, 'not_found')
  const { client: _client, ...row } = vb
  return row
}
