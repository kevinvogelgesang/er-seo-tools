-- AlterTable
ALTER TABLE "AdaAudit" ADD COLUMN "requestedBy" TEXT;

-- AlterTable
ALTER TABLE "SiteAudit" ADD COLUMN "requestedBy" TEXT;

-- Backfill: mark all pre-feature audits as "Testing"
UPDATE "SiteAudit" SET "requestedBy" = 'Testing' WHERE "requestedBy" IS NULL;
UPDATE "AdaAudit"  SET "requestedBy" = 'Testing'
  WHERE "requestedBy" IS NULL AND "siteAuditId" IS NULL;
