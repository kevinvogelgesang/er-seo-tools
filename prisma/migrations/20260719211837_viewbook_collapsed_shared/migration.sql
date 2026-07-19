-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ViewbookSection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewbookId" INTEGER NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "collapsedShared" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" DATETIME,
    "introNote" TEXT,
    "narrative" TEXT,
    "acknowledgedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ViewbookSection_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ViewbookSection" ("acknowledgedAt", "doneAt", "id", "introNote", "narrative", "sectionKey", "state", "updatedAt", "viewbookId") SELECT "acknowledgedAt", "doneAt", "id", "introNote", "narrative", "sectionKey", "state", "updatedAt", "viewbookId" FROM "ViewbookSection";
DROP TABLE "ViewbookSection";
ALTER TABLE "new_ViewbookSection" RENAME TO "ViewbookSection";
CREATE UNIQUE INDEX "ViewbookSection_viewbookId_sectionKey_key" ON "ViewbookSection"("viewbookId", "sectionKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill: shipped operator collapse (state='collapsed') becomes the shared default.
-- updatedAt stamped explicitly (raw SQL bypasses @updatedAt). 1784495927764 = author-time epoch ms.
UPDATE "ViewbookSection"
  SET "collapsedShared" = true, "state" = 'active', "updatedAt" = 1784495927764
  WHERE "state" = 'collapsed';

-- Bump syncVersion on affected parent books so already-open browsers refetch after deploy.
UPDATE "Viewbook"
  SET "syncVersion" = "syncVersion" + 1, "updatedAt" = 1784495927764
  WHERE "id" IN (SELECT DISTINCT "viewbookId" FROM "ViewbookSection" WHERE "collapsedShared" = true);
