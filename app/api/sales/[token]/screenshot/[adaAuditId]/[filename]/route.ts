// C14: token-validated screenshot streaming. Authorization = ownership chain
// (token → prospect → child audit's parent SiteAudit.prospectId). The URL pins
// the child audit id so an open report keeps loading its own images after a
// re-scan (spec Codex fix #3). Internal cookie-gated route untouched.
import fs from 'fs/promises'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { SCREENSHOTS_DIR } from '@/lib/ada-audit/screenshot-helpers'
import { curatedScreenshotSet, validateSalesToken } from '@/lib/sales/sales-report-data'

const AUDIT_ID_RE = /^[a-z0-9]+$/i
const FILENAME_RE = /^[a-z0-9_-]+\.png$/i

export const GET = withRoute(
  async (_request: NextRequest, { params }: { params: Promise<{ token: string; adaAuditId: string; filename: string }> }) => {
    const { token, adaAuditId, filename } = await params
    const notFoundRes = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (!AUDIT_ID_RE.test(adaAuditId) || !FILENAME_RE.test(filename)) return notFoundRes()
    const prospect = await validateSalesToken(token)
    if (!prospect) return notFoundRes()
    // Curated-set enforcement (spec + Codex): the token authorizes ONLY the
    // screenshots the pinned audit's report actually renders — ownership plus
    // membership, so a guessed filename under an owned audit still 404s.
    const allowed = await curatedScreenshotSet(prospect.id, adaAuditId)
    if (!allowed.has(`${adaAuditId}/${filename}`)) return notFoundRes()

    try {
      const buffer = await fs.readFile(path.join(SCREENSHOTS_DIR, adaAuditId, filename))
      return new Response(new Uint8Array(buffer), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' },
      })
    } catch {
      return notFoundRes()
    }
  },
)
