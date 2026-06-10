-- Dedupe existing (siteAuditId, url) pairs before the unique index lands.
-- Keep the earliest child per pair (createdAt, then id, ascending). Children
-- of a site audit are one-per-page; historical duplicates (same URL twice in
-- a discovered set) are redundant page results — the parent's precomputed
-- summary JSON is unaffected.
DELETE FROM "AdaAudit"
WHERE "siteAuditId" IS NOT NULL
  AND "id" NOT IN (
    SELECT "id" FROM (
      SELECT "id",
             ROW_NUMBER() OVER (
               PARTITION BY "siteAuditId", "url"
               ORDER BY "createdAt" ASC, "id" ASC
             ) AS rn
      FROM "AdaAudit"
      WHERE "siteAuditId" IS NOT NULL
    )
    WHERE rn = 1
  );

-- CreateIndex
CREATE UNIQUE INDEX "AdaAudit_siteAuditId_url_key" ON "AdaAudit"("siteAuditId", "url");
