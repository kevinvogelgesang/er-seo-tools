-- Task 1: graph scalars, durable CrawlRun.seoIntent, SiteAudit.seoIntent, PillarAnalysis decouple
-- CrawlPage: inlinks / outlinks graph scalars (nullable, no default)
ALTER TABLE "CrawlPage" ADD COLUMN "inlinks" INTEGER;
ALTER TABLE "CrawlPage" ADD COLUMN "outlinks" INTEGER;

-- SiteAudit: seoIntent flag (autonomous SEO pipeline marker)
ALTER TABLE "SiteAudit" ADD COLUMN "seoIntent" BOOLEAN NOT NULL DEFAULT false;

-- CrawlRun: seoIntent flag (autonomous SEO pipeline marker)
ALTER TABLE "CrawlRun" ADD COLUMN "seoIntent" BOOLEAN NOT NULL DEFAULT false;

-- PillarAnalysis: sessionId NOT NULL -> NULL (keep @unique), add crawlRunId/clientId/domain.
-- SQLite cannot ALTER a column's NOT NULL constraint, so we rebuild the table.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PillarAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sessionId" TEXT,
    "crawlRunId" TEXT,
    "clientId" INTEGER,
    "domain" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "runnerVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "score" INTEGER,
    "subscores" TEXT,
    "subscorePresence" TEXT,
    "subscoreContext" TEXT,
    "dataCompleteness" REAL,
    "hubRecommendation" TEXT,
    "pillarTopics" TEXT,
    "urlVerdicts" TEXT,
    "aiNarrative" TEXT,
    "narrativeUpdatedAt" DATETIME,
    CONSTRAINT "PillarAnalysis_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PillarAnalysis_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PillarAnalysis" ("id", "createdAt", "updatedAt", "sessionId", "status", "error", "runnerVersion", "score", "subscores", "subscorePresence", "subscoreContext", "dataCompleteness", "hubRecommendation", "pillarTopics", "urlVerdicts", "aiNarrative", "narrativeUpdatedAt") SELECT "id", "createdAt", "updatedAt", "sessionId", "status", "error", "runnerVersion", "score", "subscores", "subscorePresence", "subscoreContext", "dataCompleteness", "hubRecommendation", "pillarTopics", "urlVerdicts", "aiNarrative", "narrativeUpdatedAt" FROM "PillarAnalysis";
DROP TABLE "PillarAnalysis";
ALTER TABLE "new_PillarAnalysis" RENAME TO "PillarAnalysis";
CREATE UNIQUE INDEX "PillarAnalysis_sessionId_key" ON "PillarAnalysis"("sessionId");
CREATE UNIQUE INDEX "PillarAnalysis_crawlRunId_key" ON "PillarAnalysis"("crawlRunId");
CREATE INDEX "PillarAnalysis_sessionId_status_idx" ON "PillarAnalysis"("sessionId", "status");
CREATE INDEX "PillarAnalysis_status_idx" ON "PillarAnalysis"("status");
CREATE INDEX "PillarAnalysis_createdAt_idx" ON "PillarAnalysis"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
