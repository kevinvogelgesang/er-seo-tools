export function formatDuration(startedAt: Date | null, completedAt: Date | null): string | null {
  if (!startedAt || !completedAt) return null
  const ms = completedAt.getTime() - startedAt.getTime()
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remSec = seconds % 60
  if (minutes < 60) return `${minutes}m ${remSec}s`
  const hours = Math.floor(minutes / 60)
  const remMin = minutes % 60
  return `${hours}h ${remMin}m`
}

export function formatDurationHover(startedAt: Date | null, completedAt: Date | null): string | null {
  if (!startedAt || !completedAt) return null
  return `Started ${startedAt.toLocaleTimeString()} → Ended ${completedAt.toLocaleTimeString()}`
}
