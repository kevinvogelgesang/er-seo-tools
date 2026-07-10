-- KS-1: GscSnapshot — durable client-scoped GSC query/query×page keyword
-- snapshot. Raw rows stored as JSON text columns; derivations are computed
-- at read time (lib/keywords/derive.ts), never persisted.

-- CreateTable
CREATE TABLE "GscSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL,
    "gscSiteUrl" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowStart" DATETIME NOT NULL,
    "windowEnd" DATETIME NOT NULL,
    "queryRowLimit" INTEGER NOT NULL,
    "queryPageRowLimit" INTEGER NOT NULL,
    "queryAtLimit" BOOLEAN NOT NULL,
    "queryPageAtLimit" BOOLEAN NOT NULL,
    "minImpressions" INTEGER NOT NULL,
    "queryRowsJson" TEXT NOT NULL,
    "queryPageRowsJson" TEXT NOT NULL,
    CONSTRAINT "GscSnapshot_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "GscSnapshot_clientId_fetchedAt_idx" ON "GscSnapshot"("clientId", "fetchedAt");
