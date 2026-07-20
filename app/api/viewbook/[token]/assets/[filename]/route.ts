// Public token-gated theme-asset serving (spec §6/§7). Authorization is an
// ALLOWLIST, C14 curated-set precedent: the token's own themeJson filenames,
// viewbookDoc rows, assessment images, and feedback screenshots (all viewbook
// scope), or the global team-roster photo set (global scope). Assessment
// images and feedback screenshots are NEVER global-scoped — both lookups are
// fenced on the token's own viewbook (assessment via
// `content: { viewbookId: vb.id }`, feedback via the
// reviewLink→milestone→viewbookId chain) and can only ever match the token's
// own viewbook. A guessed filename under an owned viewbook still 404s. Every
// failure — bad token, revoked, archived client, non-allowlisted name,
// cross-viewbook name, traversal shape, missing file — is the SAME 404 (no
// oracle). Non-ENOENT fs errors rethrow into withRoute as 500 (operational
// visibility, C14 hero precedent).
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { readViewbookAsset } from '@/lib/viewbook/assets'
import { parseStoredThemeWide } from '@/lib/viewbook/theme-server'
import { getGlobalContent } from '@/lib/viewbook/global-content'
import { prisma } from '@/lib/db'

export const GET = withRoute(
  async (_request: NextRequest, { params }: { params: Promise<{ token: string; filename: string }> }) => {
    const { token, filename } = await params
    const notFoundRes = () => NextResponse.json({ error: 'not_found' }, { status: 404 })

    // Throws HttpError(404) on invalid/revoked/archived — withRoute maps it.
    const vb = await requireViewbookToken(token)

    const theme = parseStoredThemeWide(vb.themeJson)
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
        const assessmentImage = await prisma.viewbookAssessmentImage.findFirst({
          where: { filename, content: { viewbookId: vb.id } },
          select: { filename: true },
        })
        if (assessmentImage) {
          asset = await readViewbookAsset(String(vb.id), filename)
        } else {
          const feedbackImage = await prisma.viewbookFeedbackImage.findFirst({
            where: { filename, feedback: { reviewLink: { milestone: { viewbookId: vb.id } } } },
            select: { filename: true },
          })
          if (feedbackImage) {
            asset = await readViewbookAsset(String(vb.id), filename)
          } else {
            const roster = await getGlobalContent('team')
            const photos = new Set(
              (Array.isArray(roster) ? roster : []).map((m) => m.photo).filter((p): p is string => p != null),
            )
            if (photos.has(filename)) asset = await readViewbookAsset('global', filename)
          }
        }
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
