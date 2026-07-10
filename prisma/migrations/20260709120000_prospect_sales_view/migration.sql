-- C14: Prospect model for the prospect sales audit view, plus
-- SiteAudit.prospectId (mirrors clientId/scheduleId FK shape) and
-- CrawlRun.schemaTypesJson (aggregate schema-type histogram, live-scan only).

-- CreateTable
CREATE TABLE "Prospect" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "salesToken" TEXT,
    "salesTokenExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_salesToken_key" ON "Prospect"("salesToken");

-- CreateIndex
CREATE INDEX "Prospect_domain_idx" ON "Prospect"("domain");

-- CreateIndex
CREATE INDEX "Prospect_salesTokenExpiresAt_idx" ON "Prospect"("salesTokenExpiresAt");

-- AlterTable: SiteAudit.prospectId (nullable, ON DELETE SET NULL — mirrors scheduleId)
ALTER TABLE "SiteAudit" ADD COLUMN "prospectId" INTEGER REFERENCES "Prospect" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "SiteAudit_prospectId_idx" ON "SiteAudit"("prospectId");

-- AlterTable: CrawlRun.schemaTypesJson
ALTER TABLE "CrawlRun" ADD COLUMN "schemaTypesJson" TEXT;
