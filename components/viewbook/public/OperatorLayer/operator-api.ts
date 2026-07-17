export class OperatorRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    // The parsed error-response body — carries reconciliation payloads such as
    // a 409 `stale_version`'s `current: { value, version }` so callers can
    // adopt the fresh version instead of resending the obsolete one forever.
    readonly body: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

export async function operatorRequest<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) {
    const code = body.error || `request_failed_${response.status}`
    throw new OperatorRequestError(code, response.status, code, body as Record<string, unknown>)
  }
  return body
}
