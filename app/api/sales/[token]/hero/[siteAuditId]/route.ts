// C14 hero: token-validated homepage-screenshot streaming. Authorization =
// token → prospect, then the PINNED siteAuditId must belong to that prospect
// AND carry a stamped homepageScreenshot (stamped only after a successful
// file write). Failure contract (spec Codex fix 7 + plan Codex fix 4): the
// authorization/lookup failures — bad token, wrong prospect's audit,
// malformed id, null column — AND a missing file (ENOENT) return an
// indistinguishable 404. Any OTHER fs failure (EACCES, EIO, …) rethrows into
// withRoute as a 500 — that's operational breakage that must stay visible,
// and a 500 is not an authorization oracle.
import fs from 'fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { prisma } from '@/lib/db'
import { heroScreenshotPath } from '@/lib/sales/hero-screenshot'
import { validateSalesToken } from '@/lib/sales/sales-report-data'

const AUDIT_ID_RE = /^[a-z0-9]+$/i

export const GET = withRoute(
  async (_request: NextRequest, { params }: { params: Promise<{ token: string; siteAuditId: string }> }) => {
    const { token, siteAuditId } = await params
    const notFoundRes = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (!AUDIT_ID_RE.test(siteAuditId)) return notFoundRes()
    const prospect = await validateSalesToken(token)
    if (!prospect) return notFoundRes()

    const audit = await prisma.siteAudit.findUnique({
      where: { id: siteAuditId },
      select: { prospectId: true, homepageScreenshot: true },
    })
    if (!audit || audit.prospectId !== prospect.id || !audit.homepageScreenshot) return notFoundRes()

    let buffer: Buffer
    try {
      buffer = await fs.readFile(heroScreenshotPath(siteAuditId))
    } catch (err) {
      // Only a genuinely-absent file joins the indistinguishable-404 set.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return notFoundRes()
      throw err // withRoute → 500 internal_error (operational visibility)
    }
    return new Response(new Uint8Array(buffer), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' },
    })
  },
)
