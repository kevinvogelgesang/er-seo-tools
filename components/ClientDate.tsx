'use client'
import { useEffect, useState } from 'react'
import { dateFormatters, formatInBrowserTZ, type DateVariant } from '@/lib/ada-audit/format-date'

export { formatInBrowserTZ }

export function ClientDate({ iso, variant = 'date' }: { iso: string | null | undefined; variant?: DateVariant }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (!iso) return <>—</>
  if (!mounted) return <span suppressHydrationWarning>{iso.slice(0, 10)}</span>

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return <>—</>
  return <span>{date.toLocaleString('en-US', dateFormatters[variant])}</span>
}
