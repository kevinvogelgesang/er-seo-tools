-- AlterTable
ALTER TABLE "AdaAudit" ADD COLUMN "lighthouseError" TEXT;
ALTER TABLE "AdaAudit" ADD COLUMN "lighthouseSummary" TEXT;

-- CreateTable
CREATE TABLE "PdfAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "siteAuditId" TEXT,
    "adaAuditId" TEXT,
    "url" TEXT NOT NULL,
    "fileSize" INTEGER,
    "pageCount" INTEGER,
    "status" TEXT NOT NULL,
    "issues" TEXT,
    "scanError" TEXT,
    CONSTRAINT "PdfAudit_siteAuditId_fkey" FOREIGN KEY ("siteAuditId") REFERENCES "SiteAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PdfAudit_adaAuditId_fkey" FOREIGN KEY ("adaAuditId") REFERENCES "AdaAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "summary" TEXT,
    "wcagLevel" TEXT NOT NULL DEFAULT 'wcag21aa',
    "score" INTEGER,
    "runnerType" TEXT NOT NULL DEFAULT 'jsdom',
    "discoveredUrls" TEXT,
    "clientId" INTEGER,
    CONSTRAINT "SiteAudit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SiteAudit" ("clientId", "createdAt", "discoveredUrls", "domain", "error", "id", "pagesComplete", "pagesError", "pagesTotal", "runnerType", "score", "status", "summary", "updatedAt", "wcagLevel") SELECT "clientId", "createdAt", "discoveredUrls", "domain", "error", "id", "pagesComplete", "pagesError", "pagesTotal", "runnerType", "score", "status", "summary", "updatedAt", "wcagLevel" FROM "SiteAudit";
DROP TABLE "SiteAudit";
ALTER TABLE "new_SiteAudit" RENAME TO "SiteAudit";
CREATE INDEX "SiteAudit_createdAt_idx" ON "SiteAudit"("createdAt");
CREATE INDEX "SiteAudit_status_idx" ON "SiteAudit"("status");
CREATE INDEX "SiteAudit_clientId_idx" ON "SiteAudit"("clientId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PdfAudit_siteAuditId_idx" ON "PdfAudit"("siteAuditId");

-- CreateIndex
CREATE INDEX "PdfAudit_adaAuditId_idx" ON "PdfAudit"("adaAuditId");

-- CreateIndex
CREATE UNIQUE INDEX "PdfAudit_siteAuditId_url_key" ON "PdfAudit"("siteAuditId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "PdfAudit_adaAuditId_url_key" ON "PdfAudit"("adaAuditId", "url");
