// DORMANT (2026-07-19): no longer called by the client — the viewer-facing
// collapse state is now purely local (localStorage), never shared/written to
// the server. See docs/superpowers/specs/2026-07-19-viewbook-collapse-local-
// revision.md. This module + its route + the middleware matcher are kept
// FUNCTIONAL (not deleted) in case a future "shared collapse" mode revives
// them; its tests still verify a working-but-unused route.
//
// v2 PR2: shared-collapse write (spec §6). Any token-holder may shared-COLLAPSE
// a section; shared-EXPAND is operator-only (a viewer collapsing something is
// reversible/low-stakes, re-expanding a book-wide default is an operator call).
// One fenced array-form transaction — the UPDATE and the syncVersion bump share
// the SAME self-contained predicate (token current + not revoked + client not
// archived + section present/visible/collapse-eligible + value actually
// changing), so a blocked or no-op write bumps nothing.
import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { sectionSupportsCollapse, SECTION_KEYS } from './theme'
import { syncVersionBumpWhere } from './sync'

export async function setSectionCollapsedShared(
  viewbook: { id: number },
  token: string,
  input: { sectionKey: string; collapsed: boolean; isOperator: boolean },
): Promise<{ collapsedShared: boolean }> {
  const { sectionKey, collapsed, isOperator } = input

  // Validate against REAL section keys — sectionSupportsCollapse only excludes
  // the bookends, so an arbitrary string would otherwise pass.
  if (!(SECTION_KEYS as readonly string[]).includes(sectionKey)) throw new HttpError(400, 'invalid_section')
  if (!sectionSupportsCollapse(sectionKey)) throw new HttpError(400, 'invalid_section')
  // Shared-EXPAND (collapsed=false) is operator-only. Shared-COLLAPSE is open
  // to any token-holder.
  if (!collapsed && !isOperator) throw new HttpError(403, 'operator_required')

  const now = Date.now()
  // Self-contained commit predicate: matches this book BY TOKEN (current, not
  // revoked), client not archived, section present + not hidden + collapse-
  // eligible, AND the value actually changes. Reused verbatim by the sync bump.
  const predicate = Prisma.sql`
    EXISTS (
      SELECT 1 FROM "ViewbookSection" s
      JOIN "Viewbook" v ON v."id" = s."viewbookId"
      JOIN "Client" c ON c."id" = v."clientId"
      WHERE s."viewbookId" = ${viewbook.id}
        AND s."sectionKey" = ${sectionKey}
        AND s."state" <> 'hidden'
        AND s."collapsedShared" <> ${collapsed}
        AND v."token" = ${token}
        AND v."revokedAt" IS NULL
        AND c."archivedAt" IS NULL
    )`

  const update = prisma.$executeRaw`
    UPDATE "ViewbookSection"
      SET "collapsedShared" = ${collapsed}, "updatedAt" = ${now}
      WHERE "viewbookId" = ${viewbook.id}
        AND "sectionKey" = ${sectionKey}
        AND ${predicate}`

  // Fence-shared bump placed BEFORE the update (companion-statement pattern).
  const [bumped, changed] = await prisma.$transaction([
    syncVersionBumpWhere(viewbook.id, predicate),
    update,
  ])

  // Inspect BOTH counts:
  //  - 1/1 → real change, success.
  //  - mismatched (1/0 or 0/1) → invariant violation, throw.
  //  - 0/0 → no-op: either already at the requested value (honest replay) OR
  //          blocked by the predicate (revoked/archived/hidden/rotated token).
  //          Re-read to tell them apart — only return success when the
  //          persisted value already equals the request; anything else is a
  //          blocked write.
  if (bumped !== changed) throw new HttpError(500, 'collapse_invariant')
  if (changed === 0) {
    const row = await prisma.viewbookSection.findUnique({
      where: { viewbookId_sectionKey: { viewbookId: viewbook.id, sectionKey } },
      select: { collapsedShared: true, state: true },
    })
    if (!row || row.state === 'hidden' || row.collapsedShared !== collapsed) {
      throw new HttpError(409, 'collapse_blocked') // never fabricate a 200
    }
    // else: genuine idempotent replay — value already what caller asked for.
  }
  return { collapsedShared: collapsed }
}
