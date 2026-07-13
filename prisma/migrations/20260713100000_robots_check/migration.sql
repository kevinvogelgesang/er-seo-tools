-- D4: client-attached robots/sitemap check snapshots (additive table).
CREATE TABLE "RobotsCheck" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "robotsStatus" TEXT NOT NULL,
    "robotsContentHash" TEXT,
    "robotsContent" TEXT,
    "sitemapUrlTotal" INTEGER,
    "errorCount" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL,
    "detailJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RobotsCheck_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RobotsCheck_clientId_domain_createdAt_idx" ON "RobotsCheck"("clientId", "domain", "createdAt");
