// lib/sweep/cohort.ts
//
// Pure frozen-cohort builder for the weekly client sweep (Task 4). No prisma
// import, no server-only import — this module does zero IO; callers load
// clients and pass them in. Mirrors the parse+normalize loop in
// lib/jobs/handlers/robots-monitor-sweep.ts (runRobotsMonitorSweep): malformed
// `domains` JSON or an entry that fails `normalizeClientDomain` is skipped
// silently, never thrown (D5-sweep precedent) — a bad legacy value must not
// abort the whole cohort build.
//
// normalizeClientDomain does NOT strip a leading "www." label (verified
// against lib/security/domain-validation.ts — it only trims/lowercases/
// validates charset). So "www.example.com" and "example.com" are DISTINCT
// normalized domains and both survive as separate Set members; only an
// exact-after-normalization duplicate (e.g. differing case) collapses to one.

import { normalizeClientDomain, InvalidDomainError } from '@/lib/security/domain-validation'
import type { SweepMembership } from './types'

/** Parse a `Client.domains` JSON string into its normalized, deduped domain
 *  set. Malformed JSON, a non-array document, non-string entries, and entries
 *  that fail domain validation all resolve to "no domain" rather than throw —
 *  this is the same parse loop `runRobotsMonitorSweep` uses per client. */
export function registeredDomains(domainsJson: string): Set<string> {
  const domains = new Set<string>()
  let raw: unknown = []
  try {
    raw = JSON.parse(domainsJson)
  } catch {
    /* malformed -> no domains */
  }
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== 'string') continue
      try {
        domains.add(normalizeClientDomain(entry))
      } catch (err) {
        if (err instanceof InvalidDomainError) continue // malformed legacy value
        throw err
      }
    }
  }
  return domains
}

/** Build the frozen membership cohort for this sweep run: every registered
 *  domain of every passed-in client becomes one `pending` member. Per-client
 *  dedupe only — the same domain registered on two different clients gets a
 *  member under EACH client (fan-out collapses shared-domain duplicates at
 *  enqueue time, Task 5). Order is deterministic: clientId asc, then domain
 *  asc within a client. */
export function buildCohort(
  clients: Array<{ id: number; name: string; domains: string }>,
): SweepMembership {
  const sortedClients = [...clients].sort((a, b) => a.id - b.id)

  const members: SweepMembership['members'] = []
  for (const client of sortedClients) {
    const domains = [...registeredDomains(client.domains)].sort((a, b) => a.localeCompare(b))
    for (const domain of domains) {
      members.push({
        clientId: client.id,
        clientName: client.name,
        domain,
        siteAuditId: null,
        outcome: 'pending',
      })
    }
  }

  return { v: 1, expectedCount: members.length, members }
}
