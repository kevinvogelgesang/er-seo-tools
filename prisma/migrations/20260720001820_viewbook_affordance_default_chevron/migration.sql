-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Viewbook" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "revokedAt" DATETIME,
    "themeJson" TEXT NOT NULL DEFAULT '{}',
    "welcomeNote" TEXT,
    "notifyEmail" TEXT,
    "dataLockedAt" DATETIME,
    "dataLockedBy" TEXT,
    "digestCursorId" INTEGER NOT NULL DEFAULT 0,
    "digestSentAt" DATETIME,
    "stage" TEXT NOT NULL DEFAULT 'post-contract',
    "syncVersion" INTEGER NOT NULL DEFAULT 0,
    "csmName" TEXT,
    "clientNotifyJson" TEXT NOT NULL DEFAULT '[]',
    "pcCompletedAt" DATETIME,
    "collapseAffordance" TEXT NOT NULL DEFAULT 'chevron',
    "heroOverlayStrength" INTEGER NOT NULL DEFAULT 55,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Viewbook_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Viewbook" ("clientId", "clientNotifyJson", "collapseAffordance", "createdAt", "createdBy", "csmName", "dataLockedAt", "dataLockedBy", "digestCursorId", "digestSentAt", "heroOverlayStrength", "id", "kind", "notifyEmail", "pcCompletedAt", "revokedAt", "stage", "syncVersion", "themeJson", "token", "updatedAt", "welcomeNote") SELECT "clientId", "clientNotifyJson", "collapseAffordance", "createdAt", "createdBy", "csmName", "dataLockedAt", "dataLockedBy", "digestCursorId", "digestSentAt", "heroOverlayStrength", "id", "kind", "notifyEmail", "pcCompletedAt", "revokedAt", "stage", "syncVersion", "themeJson", "token", "updatedAt", "welcomeNote" FROM "Viewbook";
DROP TABLE "Viewbook";
ALTER TABLE "new_Viewbook" RENAME TO "Viewbook";
CREATE UNIQUE INDEX "Viewbook_clientId_key" ON "Viewbook"("clientId");
CREATE UNIQUE INDEX "Viewbook_token_key" ON "Viewbook"("token");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
