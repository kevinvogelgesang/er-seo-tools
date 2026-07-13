-- D5: change-alert email idempotency marker (additive nullable column).
ALTER TABLE "RobotsCheck" ADD COLUMN "alertSentAt" DATETIME;
