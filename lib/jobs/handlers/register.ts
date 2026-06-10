// lib/jobs/handlers/register.ts — STUB, completed in Task 9
//
// Single registration point for built-in job handlers. Idempotent —
// instrumentation calls it BEFORE startup recovery (recoverJobsOnStartup may
// run onExhausted hooks, which need a populated registry) and startJobWorker
// calls it again (harmless re-register).
export function registerBuiltInJobHandlers(): void {}
