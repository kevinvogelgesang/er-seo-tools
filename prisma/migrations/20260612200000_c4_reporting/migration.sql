ALTER TABLE "SiteAudit" ADD COLUMN "shareToken" TEXT;
ALTER TABLE "SiteAudit" ADD COLUMN "shareExpiresAt" DATETIME;
ALTER TABLE "SiteAudit" ADD COLUMN "reportGeneratedAt" DATETIME;
CREATE UNIQUE INDEX "SiteAudit_shareToken_key" ON "SiteAudit"("shareToken");
