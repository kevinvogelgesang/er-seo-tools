import path from 'path'
import { promises as fs } from 'fs'
import { NextRequest, NextResponse } from 'next/server'
import { SCREENSHOTS_DIR } from '@/lib/ada-audit/screenshot-helpers'

// Strict allowlists to prevent path traversal
const AUDIT_ID_RE = /^[a-z0-9]+$/i
const FILENAME_RE = /^[a-z0-9_-]+\.png$/i

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ auditId: string; filename: string }> }
) {
  const { auditId, filename } = await params

  if (!AUDIT_ID_RE.test(auditId) || !FILENAME_RE.test(filename)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const filePath = path.join(SCREENSHOTS_DIR, auditId, filename)

  try {
    const buffer = await fs.readFile(filePath)
    return new Response(buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
