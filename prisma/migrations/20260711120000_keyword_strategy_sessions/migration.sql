-- KS-5: KeywordStrategySession — client-scoped keyword-strategy export
-- session (one row per dashboard mint, carries the memo + budget counter).
-- KeywordStrategyVolumeRequest — idempotency + exactly-once settlement audit
-- rows for the billable volume-lookup endpoint. Both FKs cascade: deleting a
-- client (or a strategy session) deletes its dependents.

-- CreateTable
CREATE TABLE "KeywordStrategySession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "clientId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "tokenMintedAt" DATETIME NOT NULL,
    "gscRefreshed" BOOLEAN NOT NULL DEFAULT false,
    "memoMarkdown" TEXT,
    "structured" TEXT,
    "memoUpdatedAt" DATETIME,
    "volumeKeywordCap" INTEGER NOT NULL,
    "volumeKeywordsUsed" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "KeywordStrategySession_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KeywordStrategyVolumeRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "strategySessionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "keywordCount" INTEGER NOT NULL,
    "settledKeywords" INTEGER,
    "fetched" INTEGER,
    "fromCache" INTEGER,
    "providerCost" REAL,
    "responseJson" TEXT,
    CONSTRAINT "KeywordStrategyVolumeRequest_strategySessionId_fkey" FOREIGN KEY ("strategySessionId") REFERENCES "KeywordStrategySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "KeywordStrategySession_clientId_createdAt_idx" ON "KeywordStrategySession"("clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordStrategyVolumeRequest_strategySessionId_idempotencyKey_key" ON "KeywordStrategyVolumeRequest"("strategySessionId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "KeywordStrategyVolumeRequest_createdAt_idx" ON "KeywordStrategyVolumeRequest"("createdAt");

-- CreateIndex
CREATE INDEX "KeywordStrategyVolumeRequest_strategySessionId_idx" ON "KeywordStrategyVolumeRequest"("strategySessionId");
