-- CreateTable
CREATE TABLE "AdaAuditCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "adaAuditId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "checkedBy" TEXT,
    CONSTRAINT "AdaAuditCheck_adaAuditId_fkey" FOREIGN KEY ("adaAuditId") REFERENCES "AdaAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SiteAuditCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "siteAuditId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "checkedBy" TEXT,
    CONSTRAINT "SiteAuditCheck_siteAuditId_fkey" FOREIGN KEY ("siteAuditId") REFERENCES "SiteAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AdaAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "result" TEXT,
    "wcagLevel" TEXT NOT NULL DEFAULT 'wcag21aa',
    "score" INTEGER,
    "shareToken" TEXT,
    "shareExpiresAt" DATETIME,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progressMessage" TEXT NOT NULL DEFAULT '',
    "runnerType" TEXT NOT NULL DEFAULT 'jsdom',
    "clientId" INTEGER,
    "siteAuditId" TEXT,
    "lighthouseSummary" TEXT,
    "lighthouseError" TEXT,
    "requestedBy" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "finalUrl" TEXT,
    "redirected" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "AdaAudit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AdaAudit_siteAuditId_fkey" FOREIGN KEY ("siteAuditId") REFERENCES "SiteAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AdaAudit" ("clientId", "createdAt", "error", "id", "lighthouseError", "lighthouseSummary", "progress", "progressMessage", "requestedBy", "result", "runnerType", "score", "shareExpiresAt", "shareToken", "siteAuditId", "status", "url", "wcagLevel") SELECT "clientId", "createdAt", "error", "id", "lighthouseError", "lighthouseSummary", "progress", "progressMessage", "requestedBy", "result", "runnerType", "score", "shareExpiresAt", "shareToken", "siteAuditId", "status", "url", "wcagLevel" FROM "AdaAudit";
DROP TABLE "AdaAudit";
ALTER TABLE "new_AdaAudit" RENAME TO "AdaAudit";
CREATE UNIQUE INDEX "AdaAudit_shareToken_key" ON "AdaAudit"("shareToken");
CREATE INDEX "AdaAudit_createdAt_idx" ON "AdaAudit"("createdAt");
CREATE INDEX "AdaAudit_clientId_idx" ON "AdaAudit"("clientId");
CREATE INDEX "AdaAudit_status_idx" ON "AdaAudit"("status");
CREATE INDEX "AdaAudit_siteAuditId_idx" ON "AdaAudit"("siteAuditId");
CREATE INDEX "AdaAudit_shareExpiresAt_idx" ON "AdaAudit"("shareExpiresAt");
CREATE INDEX "AdaAudit_requestedBy_createdAt_idx" ON "AdaAudit"("requestedBy", "createdAt");
CREATE TABLE "new_SiteAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "domain" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "pagesTotal" INTEGER NOT NULL DEFAULT 0,
    "pagesComplete" INTEGER NOT NULL DEFAULT 0,
    "pagesError" INTEGER NOT NULL DEFAULT 0,
    "pdfsTotal" INTEGER NOT NULL DEFAULT 0,
    "pdfsComplete" INTEGER NOT NULL DEFAULT 0,
    "pdfsError" INTEGER NOT NULL DEFAULT 0,
    "pdfsSkipped" INTEGER NOT NULL DEFAULT 0,
    "lighthouseTotal" INTEGER NOT NULL DEFAULT 0,
    "lighthouseComplete" INTEGER NOT NULL DEFAULT 0,
    "lighthouseError" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "wcagLevel" TEXT NOT NULL DEFAULT 'wcag21aa',
    "score" INTEGER,
    "runnerType" TEXT NOT NULL DEFAULT 'jsdom',
    "discoveredUrls" TEXT,
    "clientId" INTEGER,
    "batchId" TEXT,
    "requestedBy" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "pagesRedirected" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SiteAudit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SiteAudit_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AuditBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SiteAudit" ("batchId", "clientId", "createdAt", "discoveredUrls", "domain", "error", "id", "lighthouseComplete", "lighthouseError", "lighthouseTotal", "pagesComplete", "pagesError", "pagesTotal", "pdfsComplete", "pdfsError", "pdfsSkipped", "pdfsTotal", "requestedBy", "runnerType", "score", "status", "summary", "updatedAt", "wcagLevel") SELECT "batchId", "clientId", "createdAt", "discoveredUrls", "domain", "error", "id", "lighthouseComplete", "lighthouseError", "lighthouseTotal", "pagesComplete", "pagesError", "pagesTotal", "pdfsComplete", "pdfsError", "pdfsSkipped", "pdfsTotal", "requestedBy", "runnerType", "score", "status", "summary", "updatedAt", "wcagLevel" FROM "SiteAudit";
DROP TABLE "SiteAudit";
ALTER TABLE "new_SiteAudit" RENAME TO "SiteAudit";
CREATE INDEX "SiteAudit_createdAt_idx" ON "SiteAudit"("createdAt");
CREATE INDEX "SiteAudit_status_idx" ON "SiteAudit"("status");
CREATE INDEX "SiteAudit_clientId_idx" ON "SiteAudit"("clientId");
CREATE INDEX "SiteAudit_batchId_idx" ON "SiteAudit"("batchId");
CREATE INDEX "SiteAudit_requestedBy_createdAt_idx" ON "SiteAudit"("requestedBy", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AdaAuditCheck_adaAuditId_idx" ON "AdaAuditCheck"("adaAuditId");

-- CreateIndex
CREATE UNIQUE INDEX "AdaAuditCheck_adaAuditId_scope_key_key" ON "AdaAuditCheck"("adaAuditId", "scope", "key");

-- CreateIndex
CREATE INDEX "SiteAuditCheck_siteAuditId_idx" ON "SiteAuditCheck"("siteAuditId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteAuditCheck_siteAuditId_scope_key_key" ON "SiteAuditCheck"("siteAuditId", "scope", "key");
