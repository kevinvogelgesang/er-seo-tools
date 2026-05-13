'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import PaginatedSection from './PaginatedSection'
import QueueBatchRow from './QueueBatchRow'
import type { AuditBatchSummary, PaginatedResponse } from '@/lib/ada-audit/types'

const PAGE_SIZE = 25

export default function QueueHistoryView() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const page = Math.max(1, parseInt(searchParams.get('historyPage') ?? '1', 10) || 1)

  const [data, setData] = useState<PaginatedResponse<AuditBatchSummary> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPage = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch(`/api/audit-batches?page=${page}&pageSize=${PAGE_SIZE}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as PaginatedResponse<AuditBatchSummary>
      setData(json)
      setError(null)
    } catch (e) {
      if (data === null) setError(e instanceof Error ? e.message : 'Failed to load batches')
      else console.warn('[QueueHistoryView] reload failed:', e)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [page, data])

  useEffect(() => { void fetchPage(false) }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const setPage = useCallback((next: number) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 1) params.delete('historyPage')
    else params.set('historyPage', String(next))
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

  const items = data?.items ?? []
  const totalCount = data?.totalCount ?? 0

  return (
    <PaginatedSection
      title="Past batches"
      rowCount={totalCount}
      pageSize={PAGE_SIZE}
      page={page}
      onPageChange={setPage}
      loading={loading}
      error={error}
      onRetry={() => void fetchPage(false)}
      empty="No closed batches yet."
    >
      <div>
        {items.map((b) => <QueueBatchRow key={b.id} batch={b} />)}
      </div>
    </PaginatedSection>
  )
}
