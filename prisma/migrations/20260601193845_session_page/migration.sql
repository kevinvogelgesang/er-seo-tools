-- AlterTable
ALTER TABLE "Session" ADD COLUMN "criticalCount" INTEGER;
ALTER TABLE "Session" ADD COLUMN "noticeCount" INTEGER;
ALTER TABLE "Session" ADD COLUMN "siteHost" TEXT;
ALTER TABLE "Session" ADD COLUMN "totalUrls" INTEGER;
ALTER TABLE "Session" ADD COLUMN "warningCount" INTEGER;

-- CreateTable
CREATE TABLE "SessionPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "h1" TEXT,
    "metaDescription" TEXT,
    "wordCount" INTEGER,
    "crawlDepth" INTEGER,
    "indexable" BOOLEAN NOT NULL DEFAULT true,
    "issueTypes" TEXT NOT NULL DEFAULT '[]',
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SessionPage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SessionPage_sessionId_idx" ON "SessionPage"("sessionId");

-- CreateIndex
CREATE INDEX "SessionPage_sessionId_issueCount_idx" ON "SessionPage"("sessionId", "issueCount");
