'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { AuditDetail } from '@/lib/ada-audit/types'

interface Props {
  id: string
  initialStatus: string
}

// Polls GET /api/ada-audit/[id] every 2s until status is 'complete' or 'error',
// then refreshes the page (which re-runs the Server Component with fresh DB data).

export default function AuditPoller({ id, initialStatus }: Props) {
  const router = useRouter()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (initialStatus === 'complete' || initialStatus === 'error') return

    timerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/ada-audit/${id}`)
        if (!res.ok) return
        const data: AuditDetail = await res.json()
        if (data.status === 'complete' || data.status === 'error') {
          if (timerRef.current) clearInterval(timerRef.current)
          router.refresh()
        }
      } catch {
        // Network blip — keep polling
      }
    }, 2000)

    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [id, initialStatus, router])

  return null
}
