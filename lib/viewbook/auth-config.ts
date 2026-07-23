// Grant/session lifetimes are U1 product decisions. Rate-limit knobs remain
// optional call-time reads so tests and operations can tune them safely.
export const GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000
export const LAST_SEEN_TOUCH_MS = 60 * 60 * 1000
export const AUTH_HOUR_MS = 60 * 60 * 1000

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function authCooldownMs(): number {
  return intEnv('VIEWBOOK_AUTH_COOLDOWN_MS', 60_000)
}

export function authEmailHourlyCap(): number {
  return intEnv('VIEWBOOK_AUTH_EMAIL_HOURLY_CAP', 6)
}

export function authViewbookHourlyCap(): number {
  return intEnv('VIEWBOOK_AUTH_VIEWBOOK_HOURLY_CAP', 30)
}

export function authLedgerHourlyCap(): number {
  return intEnv('VIEWBOOK_AUTH_LEDGER_HOURLY_CAP', 200)
}
