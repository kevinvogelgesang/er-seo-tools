export type DateVariant = 'date' | 'dateTime' | 'dateTimeShort'

export const dateFormatters: Record<DateVariant, Intl.DateTimeFormatOptions> = {
  date:          { year: 'numeric', month: 'short', day: 'numeric' },
  dateTime:      { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  dateTimeShort: { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
}

export function formatInBrowserTZ(iso: string | null | undefined, variant: DateVariant = 'date'): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-US', dateFormatters[variant])
}
