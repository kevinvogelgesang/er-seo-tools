ALTER TABLE "AdaAudit" ADD COLUMN "shareExpiresAt" DATETIME;

UPDATE "AdaAudit"
SET "shareExpiresAt" = datetime('now', '+30 days')
WHERE "shareToken" IS NOT NULL AND "shareExpiresAt" IS NULL;

CREATE INDEX "AdaAudit_shareExpiresAt_idx" ON "AdaAudit"("shareExpiresAt");
