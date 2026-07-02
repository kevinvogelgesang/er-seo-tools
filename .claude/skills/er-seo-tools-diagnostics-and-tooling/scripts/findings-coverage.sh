#!/usr/bin/env bash
# findings-coverage.sh — read-only inventory of the normalized findings layer
# (CrawlRun subtree): what runs exist per tool/source, which are scored,
# which origin blobs are pruned (archived), and dual-write gap candidates.
#
# Usage:
#   bash .claude/skills/er-seo-tools-diagnostics-and-tooling/scripts/findings-coverage.sh [db-path] [clientId]
#
#   db-path default: prisma/local-dev.db. Prod: /home/seo/data/seo-tools/db.sqlite
#   clientId (optional, integer): restrict the "recent runs" listing to one client.
#
# STRICTLY READ-ONLY (-readonly + file:...?mode=ro). Safe on a live WAL DB.
set -euo pipefail

DB_PATH="${1:-prisma/local-dev.db}"
CLIENT_ID="${2:-}"
if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: no database file at '$DB_PATH'" >&2
  exit 1
fi

q() { sqlite3 -readonly -header -column "file:${DB_PATH}?mode=ro" "$1"; }
qv() { sqlite3 -readonly "file:${DB_PATH}?mode=ro" "$1"; }

# CrawlRun.seoIntent exists only after migration 20260630120000_live_seo_source
# (branch feat/autonomous-live-seo-source). On a main/prod schema (2026-07-02)
# the column is absent — fall back to a 0 literal so this script runs anywhere.
if [ "$(qv "SELECT COUNT(*) FROM pragma_table_info('CrawlRun') WHERE name='seoIntent';")" = "1" ]; then
  SEOI="seoIntent"; RSEOI="r.seoIntent"; SEOI_GROUP="tool, source, seoIntent"
else
  SEOI="0"; RSEOI="0"; SEOI_GROUP="tool, source"
  echo "(note: CrawlRun.seoIntent not in this schema — pre-live-seo-source migration; showing 0)"
fi

CLIENT_FILTER=""
if [ -n "$CLIENT_ID" ]; then
  case "$CLIENT_ID" in (*[!0-9]*) echo "clientId must be an integer" >&2; exit 1;; esac
  CLIENT_FILTER="AND r.clientId = $CLIENT_ID"
fi

echo "=== CrawlRun rollup (tool x source x seoIntent) ==="
q "SELECT tool, source, ${SEOI} AS seoIntent, COUNT(*) AS runs,
          SUM(CASE WHEN score IS NOT NULL THEN 1 ELSE 0 END) AS scored,
          SUM(CASE WHEN archivePrunedAt IS NOT NULL THEN 1 ELSE 0 END) AS archived
   FROM CrawlRun GROUP BY ${SEOI_GROUP} ORDER BY tool, source;"

echo
echo "=== Recent runs (last 20${CLIENT_ID:+, clientId=$CLIENT_ID}) ==="
# blob column: state of the ORIGIN row's JSON blob. 'n/a' = live-scan run
# (siteAuditId origin but tool=seo-parser — it never owns a blob; the
# SiteAudit.summary blob belongs to the ada-audit run).
q "SELECT substr(r.id,1,10) AS run, r.tool, r.source, ${RSEOI} AS intent,
          COALESCE(substr(r.domain,1,24),'-') AS domain,
          COALESCE(substr(c.name,1,16),'-') AS client,
          COALESCE(r.score,'-') AS score, r.pagesTotal AS pages,
          CASE
            WHEN r.sessionId IS NOT NULL THEN
              CASE WHEN se.result IS NULL THEN 'null' ELSE 'present' END
            WHEN r.adaAuditId IS NOT NULL THEN
              CASE WHEN aa.result IS NULL THEN 'null' ELSE 'present' END
            WHEN r.siteAuditId IS NOT NULL AND r.tool='ada-audit' THEN
              CASE WHEN sa.summary IS NULL THEN 'null' ELSE 'present' END
            ELSE 'n/a'
          END AS blob,
          CASE WHEN r.archivePrunedAt IS NOT NULL THEN 'yes' ELSE '' END AS archived,
          COALESCE('sess:'||substr(r.sessionId,1,8),
                   'site:'||substr(r.siteAuditId,1,8),
                   'ada:'||substr(r.adaAuditId,1,8), '-') AS origin,
          datetime(r.createdAt/1000,'unixepoch') AS created_utc
   FROM CrawlRun r
   LEFT JOIN Client c    ON c.id  = r.clientId
   LEFT JOIN Session se  ON se.id = r.sessionId
   LEFT JOIN SiteAudit sa ON sa.id = r.siteAuditId
   LEFT JOIN AdaAudit aa ON aa.id = r.adaAuditId
   WHERE 1=1 $CLIENT_FILTER
   ORDER BY r.createdAt DESC LIMIT 20;"

echo
echo "=== Dual-write gap candidates (complete origin, no findings run) ==="
echo "    Pre-A2 rows (created before 2026-06-11) are EXPECTED here — never backfill those."
echo "    A post-A2 row here = a failed dual-write: grep logs for '[findings]' and run"
echo "    npx tsx scripts/findings-rebuild.ts <id>  (see skill doc for exact invocation)."
q "SELECT 'session' AS kind, substr(s.id,1,14) AS id,
          datetime(s.createdAt/1000,'unixepoch') AS created_utc,
          CASE WHEN s.result IS NULL THEN 'blob-null (unrebuildable)' ELSE 'blob-present' END AS blob
   FROM Session s
   WHERE s.status='complete'
     AND NOT EXISTS (SELECT 1 FROM CrawlRun r WHERE r.sessionId = s.id)
   ORDER BY s.createdAt DESC LIMIT 10;"
q "SELECT 'site-audit' AS kind, substr(a.id,1,14) AS id,
          datetime(a.createdAt/1000,'unixepoch') AS created_utc,
          CASE WHEN a.summary IS NULL THEN 'blob-null (unrebuildable)' ELSE 'blob-present' END AS blob
   FROM SiteAudit a
   WHERE a.status='complete'
     AND NOT EXISTS (SELECT 1 FROM CrawlRun r
                      WHERE r.siteAuditId = a.id AND r.tool='ada-audit')
   ORDER BY a.createdAt DESC LIMIT 10;"
q "SELECT 'standalone-ada' AS kind, substr(a.id,1,14) AS id,
          datetime(a.createdAt/1000,'unixepoch') AS created_utc,
          CASE WHEN a.result IS NULL THEN 'blob-null (unrebuildable)' ELSE 'blob-present' END AS blob
   FROM AdaAudit a
   WHERE a.siteAuditId IS NULL AND a.status='complete'
     AND NOT EXISTS (SELECT 1 FROM CrawlRun r WHERE r.adaAuditId = a.id)
   ORDER BY a.createdAt DESC LIMIT 10;"

echo
echo "=== Transient harvest backlog (should be ~empty; 7-day sweep backstops) ==="
q "SELECT (SELECT COUNT(*) FROM HarvestedLink)    AS harvested_links,
          (SELECT COUNT(*) FROM HarvestedPageSeo) AS harvested_page_seo,
          (SELECT COUNT(DISTINCT siteAuditId) FROM HarvestedLink) AS audits_with_links;"
