-- F2 D4 wipe (spec §4 migration A): every existing viewbook is test-only —
-- delete FIRST so the cascades empty every child table and the NOT NULL
-- instance-column table rebuilds below start from empty tables. MUST stay the
-- first statement (foreign_keys is ON here; the rebuild block below turns it
-- off only after this cascade has run).
DELETE FROM "Viewbook";

/*
  Warnings:

  - Added the required column `subsectionId` to the `ViewbookField` table without a default value. This is not possible if the table is not empty.
  - Added the required column `copyJson` to the `ViewbookSection` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rendererType` to the `ViewbookSection` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sortOrder` to the `ViewbookSection` table without a default value. This is not possible if the table is not empty.
  - Added the required column `templateVersion` to the `ViewbookSection` table without a default value. This is not possible if the table is not empty.
  - Added the required column `title` to the `ViewbookSection` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "ViewbookSubsection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewbookId" INTEGER NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "subsectionTemplateId" INTEGER,
    "subsectionKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "offeringWebsite" BOOLEAN NOT NULL DEFAULT false,
    "offeringVa" BOOLEAN NOT NULL DEFAULT false,
    "offeringPpc" BOOLEAN NOT NULL DEFAULT false,
    "copyJson" TEXT,
    "contentJson" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" DATETIME,
    "archiveReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ViewbookSubsection_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ViewbookSubsection_sectionId_viewbookId_fkey" FOREIGN KEY ("sectionId", "viewbookId") REFERENCES "ViewbookSection" ("id", "viewbookId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ViewbookSubsection_subsectionTemplateId_fkey" FOREIGN KEY ("subsectionTemplateId") REFERENCES "SubsectionTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

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
    "collapseMorph" TEXT NOT NULL DEFAULT 'spread',
    "heroOverlayStrength" INTEGER NOT NULL DEFAULT 55,
    "revealDurationScale" REAL NOT NULL DEFAULT 1.0,
    "firstLoadDelayMs" INTEGER NOT NULL DEFAULT 3000,
    "viewerMode" TEXT NOT NULL DEFAULT 'continuous',
    "offeringWebsite" BOOLEAN NOT NULL DEFAULT true,
    "offeringVa" BOOLEAN NOT NULL DEFAULT false,
    "offeringPpc" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Viewbook_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Viewbook" ("clientId", "clientNotifyJson", "collapseAffordance", "collapseMorph", "createdAt", "createdBy", "csmName", "dataLockedAt", "dataLockedBy", "digestCursorId", "digestSentAt", "firstLoadDelayMs", "heroOverlayStrength", "id", "kind", "notifyEmail", "pcCompletedAt", "revealDurationScale", "revokedAt", "stage", "syncVersion", "themeJson", "token", "updatedAt", "viewerMode", "welcomeNote") SELECT "clientId", "clientNotifyJson", "collapseAffordance", "collapseMorph", "createdAt", "createdBy", "csmName", "dataLockedAt", "dataLockedBy", "digestCursorId", "digestSentAt", "firstLoadDelayMs", "heroOverlayStrength", "id", "kind", "notifyEmail", "pcCompletedAt", "revealDurationScale", "revokedAt", "stage", "syncVersion", "themeJson", "token", "updatedAt", "viewerMode", "welcomeNote" FROM "Viewbook";
DROP TABLE "Viewbook";
ALTER TABLE "new_Viewbook" RENAME TO "Viewbook";
CREATE UNIQUE INDEX "Viewbook_clientId_key" ON "Viewbook"("clientId");
CREATE UNIQUE INDEX "Viewbook_token_key" ON "Viewbook"("token");
CREATE TABLE "new_ViewbookField" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewbookId" INTEGER NOT NULL,
    "subsectionId" INTEGER NOT NULL,
    "defKey" TEXT,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "value" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "valueUpdatedBy" TEXT,
    "valueUpdatedByKind" TEXT,
    "valueUpdatedAt" DATETIME,
    "archivedAt" DATETIME,
    "archiveReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookField_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ViewbookField_subsectionId_viewbookId_fkey" FOREIGN KEY ("subsectionId", "viewbookId") REFERENCES "ViewbookSubsection" ("id", "viewbookId") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ViewbookField" ("archivedAt", "category", "createdAt", "createdBy", "defKey", "fieldType", "id", "label", "sortOrder", "value", "valueUpdatedAt", "valueUpdatedBy", "valueUpdatedByKind", "version", "viewbookId") SELECT "archivedAt", "category", "createdAt", "createdBy", "defKey", "fieldType", "id", "label", "sortOrder", "value", "valueUpdatedAt", "valueUpdatedBy", "valueUpdatedByKind", "version", "viewbookId" FROM "ViewbookField";
DROP TABLE "ViewbookField";
ALTER TABLE "new_ViewbookField" RENAME TO "ViewbookField";
CREATE UNIQUE INDEX "ViewbookField_viewbookId_defKey_key" ON "ViewbookField"("viewbookId", "defKey");
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
    "sectionTemplateId" INTEGER,
    "rendererType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "copyJson" TEXT NOT NULL,
    "contentJson" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" DATETIME,
    "archiveReason" TEXT,
    CONSTRAINT "ViewbookSection_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ViewbookSection_sectionTemplateId_fkey" FOREIGN KEY ("sectionTemplateId") REFERENCES "SectionTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ViewbookSection" ("acknowledgedAt", "collapsedShared", "doneAt", "id", "introNote", "narrative", "sectionKey", "state", "updatedAt", "viewbookId") SELECT "acknowledgedAt", "collapsedShared", "doneAt", "id", "introNote", "narrative", "sectionKey", "state", "updatedAt", "viewbookId" FROM "ViewbookSection";
DROP TABLE "ViewbookSection";
ALTER TABLE "new_ViewbookSection" RENAME TO "ViewbookSection";
CREATE UNIQUE INDEX "ViewbookSection_viewbookId_sectionKey_key" ON "ViewbookSection"("viewbookId", "sectionKey");
CREATE UNIQUE INDEX "ViewbookSection_id_viewbookId_key" ON "ViewbookSection"("id", "viewbookId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ViewbookSubsection_viewbookId_idx" ON "ViewbookSubsection"("viewbookId");

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookSubsection_sectionId_subsectionKey_key" ON "ViewbookSubsection"("sectionId", "subsectionKey");

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookSubsection_id_viewbookId_key" ON "ViewbookSubsection"("id", "viewbookId");
