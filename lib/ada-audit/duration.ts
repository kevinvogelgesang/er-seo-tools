function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

export function formatDuration(startedAt: string | Date | null | undefined, completedAt: string | Date | null | undefined): string | null {
  const s = toDate(startedAt)
  const c = toDate(completedAt)
  if (!s || !c) return null
  const ms = c.getTime() - s.getTime()
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remSec = seconds % 60
  if (minutes < 60) return `${minutes}m ${remSec}s`
  const hours = Math.floor(minutes / 60)
  const remMin = minutes % 60
  return `${hours}h ${remMin}m`
}

export function formatDurationHover(startedAt: string | Date | null | undefined, completedAt: string | Date | null | undefined): string | null {
  const s = toDate(startedAt)
  const c = toDate(completedAt)
  if (!s || !c) return null
  return `Started ${s.toLocaleTimeString()} → Ended ${c.toLocaleTimeString()}`
}
