-- CreateTable
CREATE TABLE "HarvestedPageError" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteAuditId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HarvestedPageError_siteAuditId_fkey" FOREIGN KEY ("siteAuditId") REFERENCES "SiteAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "HarvestedPageError_siteAuditId_url_key" ON "HarvestedPageError"("siteAuditId", "url");

-- CreateIndex
CREATE INDEX "HarvestedPageError_siteAuditId_idx" ON "HarvestedPageError"("siteAuditId");
