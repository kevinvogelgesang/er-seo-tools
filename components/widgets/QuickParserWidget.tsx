'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DropZone } from '@/components/ui/DropZone'
import { uploadAndParse } from '@/lib/seo-parser/client-upload'
import type { WidgetSize } from '@/lib/widgets/types'

export function QuickParserWidget({ size }: { size: WidgetSize }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFiles(files: File[]) {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const { sessionId } = await uploadAndParse(files)
      router.push(`/seo-audits/results/${sessionId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <DropZone
        onFiles={handleFiles}
        disabled={busy}
        label={busy ? 'Uploading…' : 'Drop Screaming Frog CSVs or click to browse'}
      />
      {error && <p className="text-[12px] font-body text-red-600 dark:text-red-400">{error}</p>}
      {size !== 'sm' && !error && (
        <p className="text-[11px] font-body text-gray-400 dark:text-white/40">
          internal_all.csv, page_titles, meta_description, h1, response_codes…
        </p>
      )}
    </div>
  )
}
