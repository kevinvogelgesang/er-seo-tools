-- Drop the old single-field unique index on CrawlRun.siteAuditId.
DROP INDEX "CrawlRun_siteAuditId_key";

-- Compound unique: one CrawlRun per (siteAuditId, tool). NULL siteAuditId rows
-- (session/standalone origins) are unconstrained — SQLite allows many NULLs.
CREATE UNIQUE INDEX "CrawlRun_siteAuditId_tool_key" ON "CrawlRun"("siteAuditId", "tool");

-- Transient harvested link/image targets (deleted post-verify; 7-day retention backstop).
CREATE TABLE "HarvestedLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteAuditId" TEXT NOT NULL,
    "sourcePageUrl" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "harvestTruncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HarvestedLink_siteAuditId_fkey" FOREIGN KEY ("siteAuditId") REFERENCES "SiteAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "HarvestedLink_siteAuditId_idx" ON "HarvestedLink"("siteAuditId");
CREATE INDEX "HarvestedLink_siteAuditId_targetUrl_idx" ON "HarvestedLink"("siteAuditId", "targetUrl");
