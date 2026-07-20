export type Tone = 'neutral' | 'running' | 'success' | 'error' | 'warning'

const TONES: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60',
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  success: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
}

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-body font-semibold leading-4 ${TONES[tone]}`}>
      {label}
    </span>
  )
}
