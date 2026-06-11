-- CreateTable
CREATE TABLE "CrawlRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tool" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "domain" TEXT,
    "clientId" INTEGER,
    "sessionId" TEXT,
    "siteAuditId" TEXT,
    "adaAuditId" TEXT,
    "status" TEXT NOT NULL,
    "score" INTEGER,
    "wcagLevel" TEXT,
    "pagesTotal" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "archivePrunedAt" DATETIME,
    CONSTRAINT "CrawlRun_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CrawlRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CrawlRun_siteAuditId_fkey" FOREIGN KEY ("siteAuditId") REFERENCES "SiteAudit" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CrawlRun_adaAuditId_fkey" FOREIGN KEY ("adaAuditId") REFERENCES "AdaAudit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CrawlPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT,
    "error" TEXT,
    "finalUrl" TEXT,
    "statusCode" INTEGER,
    "title" TEXT,
    "h1" TEXT,
    "metaDescription" TEXT,
    "wordCount" INTEGER,
    "crawlDepth" INTEGER,
    "indexable" BOOLEAN,
    "score" INTEGER,
    "adaAuditId" TEXT,
    CONSTRAINT "CrawlPage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CrawlRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "pageId" TEXT,
    "scope" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "url" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "affectedComplete" BOOLEAN,
    "affectedSource" TEXT,
    "detail" TEXT,
    "dedupKey" TEXT NOT NULL,
    CONSTRAINT "Finding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CrawlRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Finding_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "CrawlPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Violation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "findingId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "wcagTags" TEXT NOT NULL,
    "help" TEXT,
    "helpUrl" TEXT,
    "nodeCount" INTEGER NOT NULL DEFAULT 0,
    "nodes" TEXT,
    CONSTRAINT "Violation_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Violation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CrawlRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Violation_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "CrawlPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CrawlRun_sessionId_key" ON "CrawlRun"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlRun_siteAuditId_key" ON "CrawlRun"("siteAuditId");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlRun_adaAuditId_key" ON "CrawlRun"("adaAuditId");

-- CreateIndex
CREATE INDEX "CrawlRun_clientId_tool_createdAt_idx" ON "CrawlRun"("clientId", "tool", "createdAt");

-- CreateIndex
CREATE INDEX "CrawlRun_domain_createdAt_idx" ON "CrawlRun"("domain", "createdAt");

-- CreateIndex
CREATE INDEX "CrawlRun_createdAt_idx" ON "CrawlRun"("createdAt");

-- CreateIndex
CREATE INDEX "CrawlPage_runId_idx" ON "CrawlPage"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlPage_runId_url_key" ON "CrawlPage"("runId", "url");

-- CreateIndex
CREATE INDEX "Finding_runId_severity_idx" ON "Finding"("runId", "severity");

-- CreateIndex
CREATE INDEX "Finding_runId_scope_idx" ON "Finding"("runId", "scope");

-- CreateIndex
CREATE INDEX "Finding_type_idx" ON "Finding"("type");

-- CreateIndex
CREATE INDEX "Finding_pageId_idx" ON "Finding"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_runId_dedupKey_key" ON "Finding"("runId", "dedupKey");

-- CreateIndex
CREATE UNIQUE INDEX "Violation_findingId_key" ON "Violation"("findingId");

-- CreateIndex
CREATE INDEX "Violation_runId_impact_idx" ON "Violation"("runId", "impact");

-- CreateIndex
CREATE INDEX "Violation_ruleId_idx" ON "Violation"("ruleId");

-- CreateIndex
CREATE INDEX "Violation_pageId_idx" ON "Violation"("pageId");

