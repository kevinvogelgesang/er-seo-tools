#!/usr/bin/env bash
# audit-state.sh — "is this audit stuck or working?" Read-only snapshot of
# transient SiteAudit / standalone AdaAudit rows, joined against durable-job
# liveness (the same signals recovery uses).
#
# Usage:
#   bash .claude/skills/er-seo-tools-diagnostics-and-tooling/scripts/audit-state.sh [db-path]
#
#   db-path default: prisma/local-dev.db. Prod: $DATA_HOME/db.sqlite
#
# Verdict logic mirrors lib/ada-audit/queue-manager.ts recoverOrFailTransient:
#   active jobs in group 'site-audit:<id>' > 0            -> WORKING (resume)
#   0 jobs, updatedAt fresh (<5 min)                      -> SETTLING
#   0 jobs, updatedAt stale (>=5 min = STALE_MS)          -> STUCK (the 10-min
#     stale-audit-reset sweep will try one finalize, then fail it)
# Standalone AdaAudit has NO updatedAt: liveness = jobs in 'ada-audit:<id>'
# plus a 5-min createdAt race guard (lib/ada-audit/standalone-recovery.ts).
#
# STRICTLY READ-ONLY (-readonly + file:...?mode=ro). Safe on a live WAL DB.
set -euo pipefail

DB_PATH="${1:-prisma/local-dev.db}"
if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: no database file at '$DB_PATH'" >&2
  exit 1
fi

q() { sqlite3 -readonly -header -column "file:${DB_PATH}?mode=ro" "$1"; }

echo "=== Transient site audits (running | pdfs-running | lighthouse-running) ==="
q "SELECT substr(s.id,1,12) AS id, s.status, substr(s.domain,1,30) AS domain,
          ROUND((strftime('%s','now')*1000 - s.updatedAt)/60000.0, 1) AS idle_min,
          s.pagesComplete || '+' || s.pagesError || '/' || s.pagesTotal AS pages,
          (s.pdfsComplete + s.pdfsError + s.pdfsSkipped) || '/' || s.pdfsTotal AS pdfs,
          (s.lighthouseComplete + s.lighthouseError) || '/' || s.lighthouseTotal AS lh,
          CASE WHEN s.discoveredUrls IS NULL THEN 'no' ELSE 'yes' END AS discovered,
          (SELECT COUNT(*) FROM Job j
            WHERE j.groupKey = 'site-audit:' || s.id
              AND j.status IN ('queued','running')) AS jobs,
          CASE
            WHEN (SELECT COUNT(*) FROM Job j WHERE j.groupKey='site-audit:'||s.id
                    AND j.status IN ('queued','running')) > 0 THEN 'WORKING'
            WHEN (strftime('%s','now')*1000 - s.updatedAt) < 300000 THEN 'SETTLING'
            ELSE 'STUCK (stale sweep will finalize-or-fail)'
          END AS verdict
   FROM SiteAudit s
   WHERE s.status IN ('running','pdfs-running','lighthouse-running')
   ORDER BY s.createdAt;"

echo
echo "=== Queued site audits (FIFO — one runs at a time) ==="
q "SELECT substr(id,1,12) AS id, substr(domain,1,30) AS domain,
          ROUND((strftime('%s','now')*1000 - createdAt)/60000.0, 1) AS waited_min,
          COALESCE(requestedBy,'') AS requestedBy
   FROM SiteAudit WHERE status IN ('queued','pending')
   ORDER BY createdAt;"

echo
echo "=== Standalone ADA audits in flight (no updatedAt — job liveness is truth) ==="
q "SELECT substr(a.id,1,12) AS id, a.status, substr(a.url,1,40) AS url,
          ROUND((strftime('%s','now')*1000 - a.createdAt)/60000.0, 1) AS age_min,
          a.progress,
          (SELECT COUNT(*) FROM Job j
            WHERE j.groupKey = 'ada-audit:' || a.id
              AND j.status IN ('queued','running')) AS jobs,
          CASE
            WHEN (SELECT COUNT(*) FROM Job j WHERE j.groupKey='ada-audit:'||a.id
                    AND j.status IN ('queued','running')) > 0 THEN 'WORKING'
            WHEN (strftime('%s','now')*1000 - a.createdAt) < 300000 THEN 'grace (race guard)'
            ELSE 'ORPHAN (standalone recovery will fail it)'
          END AS verdict
   FROM AdaAudit a
   WHERE a.siteAuditId IS NULL AND a.status IN ('pending','running')
   ORDER BY a.createdAt;"

echo
echo "=== Stranded broken-link verifiers (complete audit + harvest rows, no live-scan run, no job) ==="
echo "    (non-empty here = the fire-and-forget enqueue crash window; boot/10-min recovery re-enqueues)"
q "SELECT substr(s.id,1,12) AS id, substr(s.domain,1,30) AS domain,
          datetime(s.completedAt/1000,'unixepoch') AS completed_utc,
          (SELECT COUNT(*) FROM HarvestedLink h WHERE h.siteAuditId=s.id) AS harvested_links,
          (SELECT COUNT(*) FROM HarvestedPageSeo p WHERE p.siteAuditId=s.id) AS harvested_pages
   FROM SiteAudit s
   WHERE s.status = 'complete'
     AND (EXISTS (SELECT 1 FROM HarvestedLink h WHERE h.siteAuditId=s.id)
          OR EXISTS (SELECT 1 FROM HarvestedPageSeo p WHERE p.siteAuditId=s.id))
     AND NOT EXISTS (SELECT 1 FROM CrawlRun r
                      WHERE r.siteAuditId=s.id AND r.tool='seo-parser')
     AND NOT EXISTS (SELECT 1 FROM Job j
                      WHERE j.groupKey='site-audit:'||s.id
                        AND j.type='broken-link-verify'
                        AND j.status IN ('queued','running'))
   LIMIT 10;"
