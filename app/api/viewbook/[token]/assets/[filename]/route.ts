// Public token-gated theme-asset serving (spec §6/§7). Authorization is an
// ALLOWLIST, C14 curated-set precedent: the token's own themeJson filenames
// (viewbook scope) or the global team-roster photo set (global scope). A
// guessed filename under an owned viewbook still 404s. Every failure — bad
// token, revoked, archived client, non-allowlisted name, traversal shape,
// missing file — is the SAME 404 (no oracle). Non-ENOENT fs errors rethrow
// into withRoute as 500 (operational visibility, C14 hero precedent).
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { readViewbookAsset } from '@/lib/viewbook/assets'
import { parseStoredTheme } from '@/lib/viewbook/theme'
import { getGlobalContent } from '@/lib/viewbook/global-content'
import { prisma } from '@/lib/db'

export const GET = withRoute(
  async (_request: NextRequest, { params }: { params: Promise<{ token: string; filename: string }> }) => {
    const { token, filename } = await params
    const notFoundRes = () => NextResponse.json({ error: 'not_found' }, { status: 404 })

    // Throws HttpError(404) on invalid/revoked/archived — withRoute maps it.
    const vb = await requireViewbookToken(token)

    const theme = parseStoredTheme(vb.themeJson)
    const themeFiles = new Set(
      [theme.logo, ...Object.values(theme.sectionHeroes)].filter((f): f is string => f != null),
    )

    let asset: { buf: Buffer; mime: string } | null = null
    if (themeFiles.has(filename)) {
      asset = await readViewbookAsset(String(vb.id), filename)
    } else {
      const doc = await prisma.viewbookDoc.findFirst({
        where: {
          filename,
          OR: [{ viewbookId: vb.id }, { viewbookId: null }],
        },
        // SQLite sorts NULL after integers for DESC: an owned collision wins.
        orderBy: { viewbookId: 'desc' },
        select: { viewbookId: true },
      })
      if (doc) {
        asset = await readViewbookAsset(doc.viewbookId == null ? 'global' : String(doc.viewbookId), filename)
      } else {
        const roster = await getGlobalContent('team')
        const photos = new Set(
          (Array.isArray(roster) ? roster : []).map((m) => m.photo).filter((p): p is string => p != null),
        )
        if (photos.has(filename)) asset = await readViewbookAsset('global', filename)
      }
    }
    if (!asset) return notFoundRes()

    const headers: Record<string, string> = {
      'Content-Type': asset.mime,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    }
    if (asset.mime === 'application/pdf') headers['Content-Disposition'] = 'inline'
    return new Response(new Uint8Array(asset.buf), { headers })
  },
)
