-- DropIndex
DROP INDEX "PillarAnalysis_sessionId_idx";

-- CreateIndex
CREATE INDEX "PillarAnalysis_sessionId_status_idx" ON "PillarAnalysis"("sessionId", "status");
