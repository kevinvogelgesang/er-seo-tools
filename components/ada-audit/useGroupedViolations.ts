'use client'

import { useState, useEffect } from 'react'
import type { SitePageResult, AxeViolation, ImpactLevel } from '@/lib/ada-audit/types'

export interface GroupedViolation {
  id: string
  help: string
  impact: ImpactLevel
  helpUrl: string
  affectedPages: Array<{
    url: string
    adaAuditId: string
    nodeCount: number
  }>
  totalNodes: number
}

const IMPACT_ORDER: ImpactLevel[] = ['critical', 'serious', 'moderate', 'minor']

export function useGroupedViolations(pages: SitePageResult[], enabled: boolean) {
  const [groupedViolations, setGroupedViolations] = useState<GroupedViolation[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return

    const issuePages = pages.filter((p) => p.status === 'complete' && p.adaAuditId)
    if (issuePages.length === 0) {
      setGroupedViolations([])
      setLoaded(true)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function fetchAll() {
      try {
        const results = await Promise.all(
          issuePages.map(async (page) => {
            try {
              const res = await fetch(`/api/ada-audit/${page.adaAuditId}`)
              if (!res.ok) return { page, violations: [] as AxeViolation[] }
              const data = await res.json()
              return { page, violations: (data.results?.violations ?? []) as AxeViolation[] }
            } catch {
              return { page, violations: [] as AxeViolation[] }
            }
          })
        )

        if (cancelled) return

        // Group by violation id
        const map = new Map<string, GroupedViolation>()

        for (const { page, violations } of results) {
          for (const v of violations) {
            if (!v.impact) continue
            const existing = map.get(v.id)
            if (existing) {
              existing.affectedPages.push({
                url: page.url,
                adaAuditId: page.adaAuditId,
                nodeCount: v.nodes.length,
              })
              existing.totalNodes += v.nodes.length
            } else {
              map.set(v.id, {
                id: v.id,
                help: v.help,
                impact: v.impact,
                helpUrl: v.helpUrl,
                affectedPages: [
                  {
                    url: page.url,
                    adaAuditId: page.adaAuditId,
                    nodeCount: v.nodes.length,
                  },
                ],
                totalNodes: v.nodes.length,
              })
            }
          }
        }

        // Sort: by impact severity, then by affected pages descending
        const sorted = Array.from(map.values()).sort((a, b) => {
          const ia = IMPACT_ORDER.indexOf(a.impact)
          const ib = IMPACT_ORDER.indexOf(b.impact)
          if (ia !== ib) return ia - ib
          return b.affectedPages.length - a.affectedPages.length
        })

        setGroupedViolations(sorted)
        setLoaded(true)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load violation data')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchAll()
    return () => { cancelled = true }
  }, [enabled, pages])

  return { groupedViolations, loading, loaded, error }
}
