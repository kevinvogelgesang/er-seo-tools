-- C12 D1: mint-extendable contentText retention + measurement-first content-audit findings.
ALTER TABLE "SiteAudit" ADD COLUMN "contentAuditRetainUntil" DATETIME;
ALTER TABLE "CrawlRun" ADD COLUMN "contentAuditJson" TEXT;
-- Codex plan #1: the every-10-min sweep filters on this column; index it.
CREATE INDEX "SiteAudit_contentAuditRetainUntil_idx" ON "SiteAudit"("contentAuditRetainUntil");
