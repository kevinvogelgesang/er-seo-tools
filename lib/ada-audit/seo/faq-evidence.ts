//
// KS-4 pure tri-state FAQ evidence derivation (spec §5). The injected parser
// only reports raw signals; the presence rule and the grammar encoder live
// HERE, Node-side. Never throws: malformed/missing/legacy input -> null,
// which the CrawlPage column stores as NULL = unknown (detection proves
// presence, never absence — a missing signal must not fabricate a negative).

export const FAQ_SIGNAL_ORDER = ['schema', 'heading', 'container', 'questions'] as const
export type FaqSignal = (typeof FAQ_SIGNAL_ORDER)[number]

// schemaTypes stores verbatim @type values — accept the URI forms too (Codex #2).
const FAQ_SCHEMA_TYPES = new Set(['FAQPage', 'https://schema.org/FAQPage', 'http://schema.org/FAQPage'])

export function deriveFaqEvidence(detailsJson: string | null): string | null {
  if (!detailsJson) return null
  let d: Record<string, unknown>
  try {
    const parsed = JSON.parse(detailsJson) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    d = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const s = d.faqSignals
  // Legacy row (pre-KS-4 detailsJson) or corrupt shape -> unknown, never not-detected.
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null
  const sig = s as Record<string, unknown>

  // Field validity (plan-Codex #1): a positive fires off any VALID true value,
  // but a NEGATIVE ('not-detected') requires EVERY field — schemaTypes
  // included — to be well-formed. A corrupt shape cannot certify absence.
  const headingValid = sig.heading === true || sig.heading === false
  const containerValid = sig.container === true || sig.container === false
  const qh = sig.questionHeadings
  const qhValid = typeof qh === 'number' && Number.isInteger(qh) && qh >= 0
  const schemaValid = Array.isArray(d.schemaTypes)
  const schemaTypes = schemaValid ? (d.schemaTypes as unknown[]) : []

  const fired: FaqSignal[] = []
  if (schemaTypes.some((t) => typeof t === 'string' && FAQ_SCHEMA_TYPES.has(t))) fired.push('schema')
  if (sig.heading === true) fired.push('heading')
  if (sig.container === true) fired.push('container')
  if (qhValid && qh >= 3) fired.push('questions')
  if (fired.length) return `present:${fired.join(',')}`
  return headingValid && containerValid && qhValid && schemaValid ? 'not-detected' : null
}
