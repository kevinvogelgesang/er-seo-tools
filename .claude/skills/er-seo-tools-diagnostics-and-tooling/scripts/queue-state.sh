#!/usr/bin/env bash
# queue-state.sh — read-only snapshot of the durable Job queue + Schedule table.
#
# Usage:
#   bash .claude/skills/er-seo-tools-diagnostics-and-tooling/scripts/queue-state.sh [db-path]
#
#   db-path default: prisma/local-dev.db (the local dev DB; Prisma resolves
#   DATABASE_URL=file:./local-dev.db relative to prisma/).
#   Prod DB (run on the server, or against a copied snapshot):
#     $DATA_HOME/db.sqlite
#
# STRICTLY READ-ONLY: the DB is opened with -readonly AND file:...?mode=ro.
# Safe against a live WAL database (readers never block the app's writer).
set -euo pipefail

DB_PATH="${1:-prisma/local-dev.db}"
if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: no database file at '$DB_PATH'" >&2
  echo "Hint: local dev DB is prisma/local-dev.db; prod is $DATA_HOME/db.sqlite" >&2
  exit 1
fi

q() { sqlite3 -readonly -header -column "file:${DB_PATH}?mode=ro" "$1"; }

echo "=== Job counts by type + status ==="
q "SELECT type, status, COUNT(*) AS n
   FROM Job GROUP BY type, status ORDER BY type, status;"

echo
echo "=== Queued backlog (oldest 10; 'backoff' = waiting out retry delay) ==="
# All DateTime columns are integer epoch-MILLISECONDS (Prisma SQLite storage).
q "SELECT substr(id,1,12) AS id, type,
          ROUND((strftime('%s','now')*1000 - createdAt)/60000.0, 1) AS age_min,
          attempts || '/' || maxAttempts AS att,
          CASE WHEN runAfter > strftime('%s','now')*1000 THEN 'backoff' ELSE 'ready' END AS gate,
          COALESCE(groupKey,'') AS groupKey
   FROM Job WHERE status='queued'
   ORDER BY createdAt ASC LIMIT 10;"

echo
echo "=== Running now (heartbeat age >120s means the 60s stale sweep will requeue it) ==="
q "SELECT substr(id,1,12) AS id, type,
          attempts || '/' || maxAttempts AS att,
          ROUND((strftime('%s','now')*1000 - COALESCE(heartbeatAt, startedAt, createdAt))/1000.0) AS hb_age_s,
          ROUND((strftime('%s','now')*1000 - COALESCE(startedAt, createdAt))/1000.0) AS runtime_s,
          COALESCE(groupKey,'') AS groupKey
   FROM Job WHERE status='running'
   ORDER BY startedAt ASC;"

echo
echo "=== Recent errors (last 15; error rows are pruned after 30 d) ==="
q "SELECT substr(id,1,12) AS id, type,
          attempts || '/' || maxAttempts AS att,
          datetime(updatedAt/1000,'unixepoch') AS at_utc,
          substr(replace(COALESCE(lastError,''), char(10), ' '), 1, 90) AS lastError
   FROM Job WHERE status='error'
   ORDER BY updatedAt DESC LIMIT 15;"

echo
echo "=== Schedules (OVERDUE = enabled, next slot >2 min past — tick runs every 60 s) ==="
q "SELECT COALESCE(name,'(client sched)') AS name, jobType, cadence, enabled,
          datetime(nextRunAt/1000,'unixepoch') AS next_utc,
          CASE WHEN enabled=1 AND nextRunAt < strftime('%s','now')*1000 - 120000
               THEN 'OVERDUE' ELSE '' END AS flag
   FROM Schedule ORDER BY nextRunAt;"
