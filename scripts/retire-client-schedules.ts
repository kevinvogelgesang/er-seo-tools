// scripts/retire-client-schedules.ts
//
// One-shot ops retirement of C2 per-client scan schedules. The weekly sweep
// (feat/weekly-client-sweep) now scans every active client automatically, so
// the per-(client,domain) 'scheduled-site-audit' Schedule rows are obsolete.
//
// Mirrors the DELETE-route semantics directly (NOT via HTTP): cancel the
// schedule's queued jobs, then delete the Schedule row — historical audits
// SetNull to manual-class via the schema relation (never destroyed). Runs
// pruneScheduledSiteAudits() once up front so window semantics match the
// live retention path. Idempotent: a second run finds nothing to retire.
//
// Usage (local): DATABASE_URL="file:./local-dev.db" npx tsx scripts/retire-client-schedules.ts
// Usage (prod):  cd $APP_HOME && npx tsx scripts/retire-client-schedules.ts
import { fileURLToPath } from 'node:url'
import { prisma } from '../lib/db'
import { cancelJobsByGroup } from '../lib/jobs/queue'
import { SCHEDULED_SITE_AUDIT_JOB_TYPE } from '../lib/jobs/handlers/scheduled-site-audit'
import { pruneScheduledSiteAudits } from '../lib/ada-audit/scheduled-retention'

export async function retireClientSchedules(): Promise<{ retired: number }> {
  // Prune schedule-originated terminal audits first, exactly as scheduled
  // retention would — keeps the latest-N-completed window semantics identical
  // to the live path before we sever the schedule link.
  await pruneScheduledSiteAudits()

  const schedules = await prisma.schedule.findMany({
    where: { jobType: SCHEDULED_SITE_AUDIT_JOB_TYPE, clientId: { not: null } },
    select: { id: true, clientId: true },
  })

  let retired = 0
  for (const sched of schedules) {
    const cancelled = await cancelJobsByGroup(`schedule:${sched.id}`)
    await prisma.schedule.delete({ where: { id: sched.id } })
    retired += 1
    console.log(
      `retired schedule ${sched.id} (client ${sched.clientId}): ${cancelled} queued job(s) cancelled`,
    )
  }
  return { retired }
}

// CLI wrapper — runs only when invoked directly (never on test import).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  retireClientSchedules()
    .then(({ retired }) => console.log(`done: ${retired} client schedule(s) retired`))
    .catch((e) => {
      console.error(e)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
