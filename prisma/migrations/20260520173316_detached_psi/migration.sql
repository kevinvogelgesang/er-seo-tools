-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    CONSTRAINT "SiteAudit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SiteAudit_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AuditBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SiteAudit" ("batchId", "clientId", "createdAt", "discoveredUrls", "domain", "error", "id", "pagesComplete", "pagesError", "pagesTotal", "pdfsComplete", "pdfsError", "pdfsTotal", "runnerType", "score", "status", "summary", "updatedAt", "wcagLevel") SELECT "batchId", "clientId", "createdAt", "discoveredUrls", "domain", "error", "id", "pagesComplete", "pagesError", "pagesTotal", "pdfsComplete", "pdfsError", "pdfsTotal", "runnerType", "score", "status", "summary", "updatedAt", "wcagLevel" FROM "SiteAudit";
DROP TABLE "SiteAudit";
ALTER TABLE "new_SiteAudit" RENAME TO "SiteAudit";
CREATE INDEX "SiteAudit_createdAt_idx" ON "SiteAudit"("createdAt");
CREATE INDEX "SiteAudit_status_idx" ON "SiteAudit"("status");
CREATE INDEX "SiteAudit_clientId_idx" ON "SiteAudit"("clientId");
CREATE INDEX "SiteAudit_batchId_idx" ON "SiteAudit"("batchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
