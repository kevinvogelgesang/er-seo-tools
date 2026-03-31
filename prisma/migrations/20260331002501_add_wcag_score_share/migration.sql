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
    "clientId" INTEGER,
    "siteAuditId" TEXT,
    CONSTRAINT "AdaAudit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AdaAudit_siteAuditId_fkey" FOREIGN KEY ("siteAuditId") REFERENCES "SiteAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AdaAudit" ("clientId", "createdAt", "error", "id", "result", "siteAuditId", "status", "url") SELECT "clientId", "createdAt", "error", "id", "result", "siteAuditId", "status", "url" FROM "AdaAudit";
DROP TABLE "AdaAudit";
ALTER TABLE "new_AdaAudit" RENAME TO "AdaAudit";
CREATE UNIQUE INDEX "AdaAudit_shareToken_key" ON "AdaAudit"("shareToken");
CREATE INDEX "AdaAudit_createdAt_idx" ON "AdaAudit"("createdAt");
CREATE INDEX "AdaAudit_clientId_idx" ON "AdaAudit"("clientId");
CREATE INDEX "AdaAudit_status_idx" ON "AdaAudit"("status");
CREATE INDEX "AdaAudit_siteAuditId_idx" ON "AdaAudit"("siteAuditId");
CREATE TABLE "new_SiteAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "domain" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "pagesTotal" INTEGER NOT NULL DEFAULT 0,
    "pagesComplete" INTEGER NOT NULL DEFAULT 0,
    "pagesError" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "wcagLevel" TEXT NOT NULL DEFAULT 'wcag21aa',
    "score" INTEGER,
    "clientId" INTEGER,
    CONSTRAINT "SiteAudit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SiteAudit" ("clientId", "createdAt", "domain", "error", "id", "pagesComplete", "pagesError", "pagesTotal", "status", "summary") SELECT "clientId", "createdAt", "domain", "error", "id", "pagesComplete", "pagesError", "pagesTotal", "status", "summary" FROM "SiteAudit";
DROP TABLE "SiteAudit";
ALTER TABLE "new_SiteAudit" RENAME TO "SiteAudit";
CREATE INDEX "SiteAudit_createdAt_idx" ON "SiteAudit"("createdAt");
CREATE INDEX "SiteAudit_status_idx" ON "SiteAudit"("status");
CREATE INDEX "SiteAudit_clientId_idx" ON "SiteAudit"("clientId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
