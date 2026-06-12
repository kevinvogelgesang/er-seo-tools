-- C2: schedule-originated site audits carry their Schedule id.
-- Nullable column + index; no backfill. ON DELETE SET NULL: deleting a
-- schedule converts its historical audits to manual-class (never pruned
-- by scheduled retention).
ALTER TABLE "SiteAudit" ADD COLUMN "scheduleId" TEXT REFERENCES "Schedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SiteAudit_scheduleId_idx" ON "SiteAudit"("scheduleId");
