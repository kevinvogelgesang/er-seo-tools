import { createHash } from 'crypto'

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k])).join(',') + '}'
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function keyForNode(input: { ruleId: string; target: string[] }): string {
  return sha256Hex(canonicalJson({ scope: 'node', ruleId: input.ruleId, target: input.target }))
}

export function keyForPage(input: { pageUrl: string }): string {
  return sha256Hex(canonicalJson({ scope: 'page', pageUrl: input.pageUrl }))
}

export function keyForPageViolation(input: { pageUrl: string; ruleId: string }): string {
  return sha256Hex(canonicalJson({ scope: 'page-violation', pageUrl: input.pageUrl, ruleId: input.ruleId }))
}
