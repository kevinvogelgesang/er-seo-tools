-- Additive nullable columns (SQLite-safe; no table rebuild).
ALTER TABLE "Job" ADD COLUMN "progress" INTEGER;
ALTER TABLE "Job" ADD COLUMN "progressMessage" TEXT;
