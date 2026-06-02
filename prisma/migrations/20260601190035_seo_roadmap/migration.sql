-- CreateTable
CREATE TABLE "SeoRoadmap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "tokenMintedAt" DATETIME,
    "roadmapMarkdown" TEXT,
    "structured" TEXT,
    "roadmapUpdatedAt" DATETIME,
    CONSTRAINT "SeoRoadmap_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SeoRoadmap_sessionId_key" ON "SeoRoadmap"("sessionId");

-- CreateIndex
CREATE INDEX "SeoRoadmap_sessionId_status_idx" ON "SeoRoadmap"("sessionId", "status");

-- CreateIndex
CREATE INDEX "SeoRoadmap_status_idx" ON "SeoRoadmap"("status");

-- CreateIndex
CREATE INDEX "SeoRoadmap_createdAt_idx" ON "SeoRoadmap"("createdAt");
