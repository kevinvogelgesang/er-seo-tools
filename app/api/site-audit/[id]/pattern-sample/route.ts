// GET /api/site-audit/[id]/pattern-sample?rule=<axeRuleId>&page=<exampleUrl>
//
// C18 bounded loader for the site-wide-patterns dropdown. Resolves the
// pattern's ONE representative child audit (CommonIssue.examplePageUrl) and
// returns that page's nodes for the given rule. NEVER fans out across affected
// pages. Cookie-gated (authed only) — the share view omits the dropdown.
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { prisma } from '@/lib/db'
import { buildArchivedAxeResults } from '@/lib/ada-audit/findings-fallback'
import type { StoredAxeResults, AxeNode } from '@/lib/ada-audit/types'

export const dynamic = 'force-dynamic'

const NODE_SAMPLE_CAP = 8
const RULE_RE = /^[a-z0-9-]{1,64}$/i
const MAX_PAGE_LEN = 2048 // cap the user-supplied page before the indexed lookup

export const GET = withRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const rule = req.nextUrl.searchParams.get('rule')
  const page = req.nextUrl.searchParams.get('page')
  if (!rule || !page || !RULE_RE.test(rule) || page.length > MAX_PAGE_LEN) {
    throw new HttpError(400, 'invalid_request')
  }

  // ONE child row — the compound unique scopes the lookup to THIS site audit,
  // so an attacker-supplied `page` can only ever read a page of this audit.
  const child = await prisma.adaAudit.findUnique({
    where: { siteAuditId_url: { siteAuditId: id, url: page } },
    select: { id: true, result: true },
  })
  if (!child) return NextResponse.json({ found: false, childAuditId: null, archived: false, nodes: [] })

  let stored: StoredAxeResults | null = null
  if (child.result) {
    try { stored = JSON.parse(child.result) as StoredAxeResults } catch { stored = null }
  }
  if (!stored) stored = await buildArchivedAxeResults(child.id) // pruned → capped no-image sample

  const violation = stored?.violations.find((v) => v.id === rule)
  const seen = new Set<string>()
  const nodes: { html: string; target: string[]; screenshotPath: string | null }[] = []
  for (const n of (violation?.nodes ?? []) as AxeNode[]) {
    const key = (n.target?.join(' ') || n.html || '').trim()
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    nodes.push({ html: n.html, target: n.target ?? [], screenshotPath: n.screenshotPath ?? null })
    if (nodes.length >= NODE_SAMPLE_CAP) break
  }

  return NextResponse.json({
    found: true,
    childAuditId: child.id,
    archived: stored?.archived ?? false,
    nodes,
  })
})
