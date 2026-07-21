'use client'
import type { SectionKey } from '@/lib/viewbook/theme'
import { navigateToAnchor } from './viewbook-navigate'

export function ChapterCtaButton({ label, sectionKey, anchor }: { label: string; sectionKey: SectionKey; anchor: string }) {
  return (
    <button
      type="button"
      data-vb-chapter-cta
      onClick={() => navigateToAnchor(sectionKey, anchor)}
      className="inline-flex items-center rounded-full px-4 py-1.5 text-sm font-semibold shadow-sm"
      style={{ background: 'var(--vb-secondary)', color: 'var(--vb-on-secondary)' }}
    >
      {label}
    </button>
  )
}
