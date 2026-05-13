-- CreateTable
CREATE TABLE "AuditBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "label" TEXT
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
    "batchId" TEXT,
    CONSTRAINT "SiteAudit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SiteAudit_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AuditBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SiteAudit" ("clientId", "createdAt", "discoveredUrls", "domain", "error", "id", "pagesComplete", "pagesError", "pagesTotal", "pdfsComplete", "pdfsError", "pdfsTotal", "runnerType", "score", "status", "summary", "updatedAt", "wcagLevel") SELECT "clientId", "createdAt", "discoveredUrls", "domain", "error", "id", "pagesComplete", "pagesError", "pagesTotal", "pdfsComplete", "pdfsError", "pdfsTotal", "runnerType", "score", "status", "summary", "updatedAt", "wcagLevel" FROM "SiteAudit";
DROP TABLE "SiteAudit";
ALTER TABLE "new_SiteAudit" RENAME TO "SiteAudit";
CREATE INDEX "SiteAudit_createdAt_idx" ON "SiteAudit"("createdAt");
CREATE INDEX "SiteAudit_status_idx" ON "SiteAudit"("status");
CREATE INDEX "SiteAudit_clientId_idx" ON "SiteAudit"("clientId");
CREATE INDEX "SiteAudit_batchId_idx" ON "SiteAudit"("batchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AuditBatch_closedAt_idx" ON "AuditBatch"("closedAt");

-- CreateIndex
CREATE INDEX "AuditBatch_startedAt_idx" ON "AuditBatch"("startedAt");

-- Enforces "at most one open batch" at the DB level. Prisma's schema DSL can't
-- model a partial unique constraint, so it lives in raw SQL. Enqueue catches
-- the Prisma P2002 error and retries by re-reading the open batch.
CREATE UNIQUE INDEX "audit_batches_one_open"
  ON "AuditBatch" ((1))
  WHERE "closedAt" IS NULL;
