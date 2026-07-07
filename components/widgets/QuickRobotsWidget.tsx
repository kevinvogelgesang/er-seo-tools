// components/widgets/QuickRobotsWidget.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { WidgetSize } from '@/lib/widgets/types'

export function QuickRobotsWidget(_props: { size: WidgetSize }) {
  const router = useRouter()
  const [url, setUrl] = useState('')

  function check() {
    const value = url.trim()
    if (!value) return
    router.push('/robots-validator?url=' + encodeURIComponent(value))
  }

  return (
    <form className="flex h-full flex-col gap-2" onSubmit={(e) => { e.preventDefault(); check() }}>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="example.com"
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[14px] text-navy dark:border-navy-border dark:bg-navy-deep dark:text-white"
      />
      <button
        type="submit"
        disabled={!url.trim()}
        className="mt-auto rounded-lg bg-navy px-4 py-2 text-[14px] font-display font-bold text-white hover:bg-navy-light disabled:opacity-50 dark:bg-white/10"
      >
        Check robots.txt
      </button>
    </form>
  )
}
