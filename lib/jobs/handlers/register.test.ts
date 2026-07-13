// lib/jobs/handlers/register.test.ts
//
// Codex spec fix #3: a handler without registration enqueues forever — prove
// every built-in type (ada-audit especially) has an owner in the registry.
import { describe, it, expect } from 'vitest'
import { registerBuiltInJobHandlers } from './register'
import { getJobHandler, clearJobRegistryForTests } from '../registry'

describe('jobs/handlers/register', () => {
  it('registers all built-in job types, including ada-audit', () => {
    clearJobRegistryForTests()
    registerBuiltInJobHandlers()
    for (const type of [
      'psi', 'pdf-scan', 'site-audit-page', 'site-audit-discover',
      'cleanup', 'screenshot-sweep', 'stale-audit-reset', 'ada-audit',
      'scheduled-site-audit', 'robots-monitor', 'robots-monitor-sweep',
    ]) {
      const h = getJobHandler(type)
      expect(h, `handler for ${type}`).toBeDefined()
      expect(h!.concurrency).toBeGreaterThan(0)
    }
  })
})
