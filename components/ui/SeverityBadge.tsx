// components/ui/SeverityBadge.tsx
//
// Compact square-rounded severity/count badge — the palette companion to
// StatusPill (which is the rounded-full LIFECYCLE pill). Tones are
// color-named, not semantic-named: severity vocabularies differ per tool
// (clients: critical/warning/notice; ada-audit: critical/serious/moderate/
// minor), so semantics→tone mapping lives in the adopting component.
// shrink-0 is part of the contract: badges sit in flex rows and must never
// compress at narrow widths.

export type BadgeTone = 'red' | 'orange' | 'amber' | 'blue' | 'purple' | 'gray'

const TONES: Record<BadgeTone, string> = {
  red: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  orange: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  purple: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400',
  gray: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60',
}

export function SeverityBadge({ label, tone, uppercase, title }: {
  label: string
  tone: BadgeTone
  uppercase?: boolean
  title?: string
}) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-body font-semibold ${uppercase ? 'uppercase ' : ''}${TONES[tone]}`}
    >
      {label}
    </span>
  )
}
