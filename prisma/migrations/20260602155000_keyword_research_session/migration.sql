-- CreateTable
CREATE TABLE "KeywordResearchSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sessionId" TEXT NOT NULL,
    "clientId" INTEGER,
    "technicalSessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "tokenMintedAt" DATETIME,
    "memoMarkdown" TEXT,
    "structured" TEXT,
    "memoUpdatedAt" DATETIME,
    CONSTRAINT "KeywordResearchSession_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "files" TEXT NOT NULL,
    "result" TEXT,
    "siteName" TEXT,
    "clientId" INTEGER,
    "workflow" TEXT NOT NULL DEFAULT 'technical',
    "siteHost" TEXT,
    "totalUrls" INTEGER,
    "criticalCount" INTEGER,
    "warningCount" INTEGER,
    "noticeCount" INTEGER,
    CONSTRAINT "Session_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Session" ("clientId", "createdAt", "criticalCount", "error", "files", "id", "noticeCount", "result", "siteHost", "siteName", "status", "totalUrls", "updatedAt", "warningCount") SELECT "clientId", "createdAt", "criticalCount", "error", "files", "id", "noticeCount", "result", "siteHost", "siteName", "status", "totalUrls", "updatedAt", "warningCount" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
CREATE INDEX "Session_createdAt_idx" ON "Session"("createdAt");
CREATE INDEX "Session_status_idx" ON "Session"("status");
CREATE INDEX "Session_clientId_idx" ON "Session"("clientId");
CREATE INDEX "Session_workflow_idx" ON "Session"("workflow");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "KeywordResearchSession_sessionId_key" ON "KeywordResearchSession"("sessionId");

-- CreateIndex
CREATE INDEX "KeywordResearchSession_sessionId_status_idx" ON "KeywordResearchSession"("sessionId", "status");

-- CreateIndex
CREATE INDEX "KeywordResearchSession_clientId_idx" ON "KeywordResearchSession"("clientId");

-- CreateIndex
CREATE INDEX "KeywordResearchSession_createdAt_idx" ON "KeywordResearchSession"("createdAt");
