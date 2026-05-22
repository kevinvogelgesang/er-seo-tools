function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k])).join(',') + '}'
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function keyForNode(input: { ruleId: string; target: string[] }): Promise<string> {
  return sha256Hex(canonicalJson({ scope: 'node', ruleId: input.ruleId, target: input.target }))
}

export async function keyForPage(input: { pageUrl: string }): Promise<string> {
  return sha256Hex(canonicalJson({ scope: 'page', pageUrl: input.pageUrl }))
}

export async function keyForPageViolation(input: { pageUrl: string; ruleId: string }): Promise<string> {
  return sha256Hex(canonicalJson({ scope: 'page-violation', pageUrl: input.pageUrl, ruleId: input.ruleId }))
}
