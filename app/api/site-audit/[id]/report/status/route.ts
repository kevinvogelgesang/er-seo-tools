// GET /api/site-audit/[id]/report/status — report lifecycle for the UI.
// 'rendering' while a report:<id> job is active; 'ready' ONLY when the
// reportGeneratedAt stamp AND the file on disk agree (never trust the
// column alone — Codex fix #6); otherwise 'none'.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { countActiveJobsByGroup } from '@/lib/jobs/queue'
import { reportFileExists } from '@/lib/report/report-file'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    select: { reportGeneratedAt: true },
  })
  if (!audit) return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })

  if (await countActiveJobsByGroup(`report:${id}`) > 0) {
    return NextResponse.json({ state: 'rendering', generatedAt: audit.reportGeneratedAt?.toISOString() ?? null })
  }
  // 'ready' requires the stamp AND the file (never trust the column alone).
  if (audit.reportGeneratedAt && (await reportFileExists(id))) {
    return NextResponse.json({ state: 'ready', generatedAt: audit.reportGeneratedAt.toISOString() })
  }
  return NextResponse.json({ state: 'none', generatedAt: null })
}
