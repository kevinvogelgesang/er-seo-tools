-- Add nullable unique name to Schedule. SQLite treats NULLs as distinct,
-- so only named (system) schedules are bound by the index.
ALTER TABLE "Schedule" ADD COLUMN "name" TEXT;
CREATE UNIQUE INDEX "Schedule_name_key" ON "Schedule"("name");
