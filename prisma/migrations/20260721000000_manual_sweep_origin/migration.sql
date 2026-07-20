-- Manual full-cohort sweep: origin tag + one-in-flight-manual guard.
ALTER TABLE "WeeklySweep" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'scheduled';

-- At most one in-flight manual sweep: every covered row has origin='manual'
-- (a constant), so uniqueness on origin permits exactly one such row. Rows with
-- snapshotJson NOT NULL (published) and all scheduled rows are excluded.
CREATE UNIQUE INDEX "weekly_sweep_one_inflight_manual"
  ON "WeeklySweep"("origin")
  WHERE "origin" = 'manual' AND "snapshotJson" IS NULL;
