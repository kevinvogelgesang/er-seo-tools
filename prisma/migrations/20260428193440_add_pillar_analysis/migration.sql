-- CreateTable
CREATE TABLE "PillarAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "runnerVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "score" INTEGER,
    "subscores" TEXT,
    "dataCompleteness" REAL,
    "hubRecommendation" TEXT,
    "pillarTopics" TEXT,
    "urlVerdicts" TEXT,
    "aiNarrative" TEXT,
    "narrativeUpdatedAt" DATETIME,
    CONSTRAINT "PillarAnalysis_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PillarAnalysis_sessionId_idx" ON "PillarAnalysis"("sessionId");

-- CreateIndex
CREATE INDEX "PillarAnalysis_status_idx" ON "PillarAnalysis"("status");

-- CreateIndex
CREATE INDEX "PillarAnalysis_createdAt_idx" ON "PillarAnalysis"("createdAt");
