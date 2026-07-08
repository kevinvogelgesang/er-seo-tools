-- D7 scan-completion email notifications: additive nullable columns on SiteAudit.
ALTER TABLE "SiteAudit" ADD COLUMN "notifyEmail" TEXT;
ALTER TABLE "SiteAudit" ADD COLUMN "notifyCompleteSentAt" DATETIME;
ALTER TABLE "SiteAudit" ADD COLUMN "notifyFailedSentAt" DATETIME;
