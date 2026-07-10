// C14: bounded curated-evidence loader — resolve the pattern's example page,
// load that ONE child audit, extract its nodes for the rule. NEVER fans out
// across all affected pages (umbrella-spec Codex fix #10 discipline).
import { prisma } from '@/lib/db'
import { buildArchivedAxeResults } from '@/lib/ada-audit/findings-fallback'
import type { CommonIssue, StoredAxeResults } from '@/lib/ada-audit/types'

export interface CuratedExample {
  html: string
  selector: string | null
  screenshotFile: string | null
  adaAuditId: string | null
  pageUrl: string | null
}

export async function loadRepresentativeExamples(
  siteAuditId: string,
  issue: CommonIssue,
  cap = 5,
): Promise<CuratedExample[]> {
  if (!issue.examplePageUrl) return []
  const child = await prisma.adaAudit.findFirst({
    where: { siteAuditId, url: issue.examplePageUrl },
    select: { id: true, url: true, result: true },
  })
  if (!child) return []

  let stored: StoredAxeResults | null = null
  if (child.result) {
    try {
      stored = JSON.parse(child.result) as StoredAxeResults
    } catch {
      stored = null
    }
  }
  // Archived degradation: blob pruned → findings-table fallback (capped nodes,
  // no screenshots). Copy in the UI labels these as a capped sample.
  if (!stored) stored = await buildArchivedAxeResults(child.id)
  if (!stored) return []

  const violation = stored.violations.find((v) => v.id === issue.ruleId)
  if (!violation) return []

  const seen = new Set<string>()
  const out: CuratedExample[] = []
  for (const node of violation.nodes) {
    if (!node.html || seen.has(node.html)) continue
    seen.add(node.html)
    out.push({
      html: node.html,
      selector: node.target?.length ? node.target[node.target.length - 1] : null,
      screenshotFile: node.screenshotPath ?? null,
      adaAuditId: child.id,
      pageUrl: child.url,
    })
    if (out.length >= cap) break
  }
  return out
}
