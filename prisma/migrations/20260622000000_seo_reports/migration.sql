-- C10: SEO Performance Reports — three new tables + Client mapping columns.
-- SeoReportBatch groups per-client SeoReport rows; ProspectsEntry holds manual
-- prospect counts. No GoogleConnection model — auth is a service-account key
-- file in env (GOOGLE_SA_KEY_FILE), not a DB row.

-- CreateTable
CREATE TABLE "SeoReportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trigger" TEXT NOT NULL,
    "scheduleId" TEXT,
    "scheduledFor" DATETIME,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "comparisonMode" TEXT NOT NULL,
    "comparisonStart" DATETIME NOT NULL,
    "comparisonEnd" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "totalReports" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SeoReportBatch_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SeoReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "clientId" INTEGER NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "comparisonStart" DATETIME NOT NULL,
    "comparisonEnd" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "ga4Status" TEXT NOT NULL DEFAULT 'pending',
    "gscStatus" TEXT NOT NULL DEFAULT 'pending',
    "prospectsStatus" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "metricsJson" TEXT,
    "generatedAt" DATETIME,
    "retainUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SeoReport_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SeoReportBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeoReport_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProspectsEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" INTEGER NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "total" INTEGER NOT NULL,
    "organic" INTEGER,
    "enteredBy" TEXT,
    "enteredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProspectsEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SeoReportBatch_scheduleId_scheduledFor_key" ON "SeoReportBatch"("scheduleId", "scheduledFor");

-- CreateIndex
CREATE INDEX "SeoReportBatch_createdAt_idx" ON "SeoReportBatch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SeoReport_batchId_clientId_key" ON "SeoReport"("batchId", "clientId");

-- CreateIndex
CREATE INDEX "SeoReport_clientId_idx" ON "SeoReport"("clientId");

-- CreateIndex
CREATE INDEX "SeoReport_batchId_idx" ON "SeoReport"("batchId");

-- CreateIndex
CREATE INDEX "SeoReport_status_idx" ON "SeoReport"("status");

-- CreateIndex
CREATE INDEX "SeoReport_retainUntil_idx" ON "SeoReport"("retainUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectsEntry_clientId_periodStart_periodEnd_key" ON "ProspectsEntry"("clientId", "periodStart", "periodEnd");

-- AlterTable: Client mapping fields for GA4 / GSC / CRM
ALTER TABLE "Client" ADD COLUMN "ga4PropertyId" TEXT;
ALTER TABLE "Client" ADD COLUMN "gscSiteUrl" TEXT;
ALTER TABLE "Client" ADD COLUMN "crmClientRef" TEXT;
