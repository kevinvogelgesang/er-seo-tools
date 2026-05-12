const TRUTHY = new Set(['1', 'true', 'yes', 'confirmed'])

function isTruthy(value: string | undefined): boolean {
  return value ? TRUTHY.has(value.trim().toLowerCase()) : false
}

function sanitizeChromeArgValue(value: string): string {
  return value.replace(/[\r\n]/g, '').trim()
}

export function getBrowserEgressLaunchArgs(): string[] {
  const args: string[] = []
  const proxyServer = sanitizeChromeArgValue(process.env.CHROME_PROXY_SERVER ?? '')
  const proxyBypassList = sanitizeChromeArgValue(process.env.CHROME_PROXY_BYPASS_LIST ?? '')

  if (proxyServer) {
    args.push(`--proxy-server=${proxyServer}`)
  }
  if (proxyBypassList) {
    args.push(`--proxy-bypass-list=${proxyBypassList}`)
  }

  return args
}

export function hasBrowserEgressGuardConfig(): boolean {
  return Boolean(process.env.CHROME_PROXY_SERVER) || isTruthy(process.env.CHROMIUM_EGRESS_GUARD_CONFIRMED)
}

export function requireBrowserEgressGuardConfig(): void {
  if (process.env.NODE_ENV !== 'production') return
  if (hasBrowserEgressGuardConfig()) return

  throw new Error(
    'Chromium ADA audits require an outbound egress guard in production. ' +
    'Set CHROME_PROXY_SERVER to an enforcing proxy, or set ' +
    'CHROMIUM_EGRESS_GUARD_CONFIRMED=true after deploying a firewall that blocks private/reserved networks.'
  )
}
