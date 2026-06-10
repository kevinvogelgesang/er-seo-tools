// lib/jobs/handlers/register.ts
//
// Single registration point for built-in job handlers. Idempotent —
// instrumentation calls it BEFORE startup recovery (recoverJobsOnStartup may
// run onExhausted hooks, which need a populated registry) and startJobWorker
// calls it again (harmless re-register).

import { registerPsiHandler } from './psi'
import { registerPdfScanHandler } from './pdf-scan'
import { registerSiteAuditPageHandler } from './site-audit-page'
import { registerSiteAuditDiscoverHandler } from './site-audit-discover'

export function registerBuiltInJobHandlers(): void {
  registerPsiHandler()
  registerPdfScanHandler()
  registerSiteAuditPageHandler()
  registerSiteAuditDiscoverHandler()
}
