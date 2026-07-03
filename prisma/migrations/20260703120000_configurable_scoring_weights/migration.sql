-- CreateTable
CREATE TABLE "ScoringWeights" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "indexability" REAL NOT NULL DEFAULT 20,
    "errorRate" REAL NOT NULL DEFAULT 20,
    "missingTitle" REAL NOT NULL DEFAULT 10,
    "missingMeta" REAL NOT NULL DEFAULT 8,
    "missingH1" REAL NOT NULL DEFAULT 7,
    "crawlDepth" REAL NOT NULL DEFAULT 15,
    "thinContent" REAL NOT NULL DEFAULT 10,
    "schema" REAL NOT NULL DEFAULT 10,
    "updatedAt" DATETIME NOT NULL
);

-- AlterTable
ALTER TABLE "CrawlRun" ADD COLUMN "scoreBreakdown" TEXT;
