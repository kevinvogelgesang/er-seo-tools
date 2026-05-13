// app/api/ada-audit/[id]/lighthouse-report/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { readLighthouseReport } from '@/lib/ada-audit/lighthouse-storage'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const report = await readLighthouseReport(id)
  if (!report) {
    return NextResponse.json({ error: 'No Lighthouse report for this audit' }, { status: 404 })
  }
  return new NextResponse(JSON.stringify(report), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="lighthouse-${id}.json"`,
    },
  })
}
