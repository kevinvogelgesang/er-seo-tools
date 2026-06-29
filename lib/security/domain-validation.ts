// Server-side validation for client "domains" (and schedule payloads).
//
// A client domain is a bare, public, lowercase hostname — e.g. `example.edu`,
// `www.school.ac.uk`. We reject anything carrying a scheme, path, query,
// fragment, credentials, port, whitespace, an IP literal, or a reserved/internal
// name. This complements (does NOT replace) the SSRF guard in `safe-url.ts`,
// which validates *URLs about to be fetched*; this guards *stored config* so
// malformed values never enter the DB, dashboards, or schedule payloads.

import { isIP } from 'node:net'

export class InvalidDomainError extends Error {
  constructor(message = 'invalid_domain') {
    super(message)
    this.name = 'InvalidDomainError'
  }
}

// Reserved / non-public name spaces. Exact `localhost` is also caught by the
// "must have a public TLD" rule, but listing it makes intent explicit.
const RESERVED_EXACT = new Set(['localhost'])
const RESERVED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp']

const MAX_DOMAIN_LENGTH = 253
const MAX_LABEL_LENGTH = 63

/**
 * Normalize and validate a single client domain.
 * @returns the normalized bare lowercase hostname
 * @throws {InvalidDomainError} if the input is not a clean public hostname
 */
export function normalizeClientDomain(input: unknown): string {
  if (typeof input !== 'string') throw new InvalidDomainError()

  let host = input.trim().toLowerCase()
  if (!host) throw new InvalidDomainError()

  // Tolerate a single trailing FQDN dot, then reject any other structural chars.
  host = host.replace(/\.$/, '')

  // No scheme/credentials/port (`:`), path/traversal (`/` or `\`), userinfo
  // (`@`), query (`?`), fragment (`#`), whitespace, or consecutive dots.
  if (/[/\\:@?#\s]/.test(host) || host.includes('..')) throw new InvalidDomainError()

  // Hostname charset only.
  if (!/^[a-z0-9.-]+$/.test(host)) throw new InvalidDomainError()

  // Client domains are hostnames, never IP literals (this also rejects loopback,
  // link-local, and private addresses like 127.0.0.1 / 169.254.169.254 / 10.x).
  if (isIP(host) !== 0) throw new InvalidDomainError()

  // Reserved / internal name spaces.
  if (RESERVED_EXACT.has(host) || RESERVED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new InvalidDomainError()
  }

  if (host.length > MAX_DOMAIN_LENGTH) throw new InvalidDomainError()

  const labels = host.split('.')
  if (labels.length < 2) throw new InvalidDomainError() // require at least name.tld

  for (const label of labels) {
    if (!label || label.length > MAX_LABEL_LENGTH) throw new InvalidDomainError()
    if (label.startsWith('-') || label.endsWith('-')) throw new InvalidDomainError()
    if (!/^[a-z0-9-]+$/.test(label)) throw new InvalidDomainError()
  }

  // Public-looking TLD: alphabetic, length >= 2 (rejects numeric TLDs / IP tails).
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1])) throw new InvalidDomainError()

  return host
}

/**
 * Validate, normalize, and de-duplicate an array of client domains.
 * @throws {InvalidDomainError} on a non-array input or the first invalid entry
 */
export function normalizeClientDomains(input: unknown): string[] {
  if (!Array.isArray(input)) throw new InvalidDomainError()

  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    const domain = normalizeClientDomain(raw)
    if (!seen.has(domain)) {
      seen.add(domain)
      out.push(domain)
    }
  }
  return out
}
