-- KS-2: KeywordVolumeCache — client-agnostic shared DataForSEO search-volume
-- cache. No FKs (two clients in the same market share hits); 30-d TTL
-- enforced at read time and pruned by pruneKeywordVolumeCache() in runCleanup.

-- CreateTable
CREATE TABLE "KeywordVolumeCache" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "keyword" TEXT NOT NULL,
    "locationCode" INTEGER NOT NULL,
    "languageCode" TEXT NOT NULL,
    "providerVersion" TEXT NOT NULL,
    "resultStatus" TEXT NOT NULL,
    "searchVolume" INTEGER,
    "cpc" REAL,
    "competitionIndex" INTEGER,
    "monthlySearchesJson" TEXT,
    "spell" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "KeywordVolumeCache_keyword_locationCode_languageCode_providerVersion_key" ON "KeywordVolumeCache"("keyword", "locationCode", "languageCode", "providerVersion");

-- CreateIndex
CREATE INDEX "KeywordVolumeCache_fetchedAt_idx" ON "KeywordVolumeCache"("fetchedAt");
