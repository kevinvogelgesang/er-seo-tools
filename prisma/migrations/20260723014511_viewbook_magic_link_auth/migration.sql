-- AlterTable
ALTER TABLE "ViewbookField" ADD COLUMN "valueUpdatedByKind" TEXT;

-- CreateTable
CREATE TABLE "ViewbookAuthGrant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "memberId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookAuthGrant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ViewbookTeamMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ViewbookMemberSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "memberId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    CONSTRAINT "ViewbookMemberSession_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ViewbookTeamMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ViewbookAuthRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "viewbookId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookAuthRequest_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ViewbookActivity" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewbookId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL DEFAULT 'client',
    "summary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookActivity_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ViewbookActivity" ("actor", "createdAt", "id", "kind", "summary", "viewbookId") SELECT "actor", "createdAt", "id", "kind", "summary", "viewbookId" FROM "ViewbookActivity";
DROP TABLE "ViewbookActivity";
ALTER TABLE "new_ViewbookActivity" RENAME TO "ViewbookActivity";
CREATE INDEX "ViewbookActivity_viewbookId_id_idx" ON "ViewbookActivity"("viewbookId", "id");
CREATE TABLE "new_ViewbookFieldAmendment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fieldId" INTEGER NOT NULL,
    "value" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorKind" TEXT NOT NULL DEFAULT 'client',
    "clientMutationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookFieldAmendment_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ViewbookField" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ViewbookFieldAmendment" ("author", "clientMutationId", "createdAt", "fieldId", "id", "value") SELECT "author", "clientMutationId", "createdAt", "fieldId", "id", "value" FROM "ViewbookFieldAmendment";
DROP TABLE "ViewbookFieldAmendment";
ALTER TABLE "new_ViewbookFieldAmendment" RENAME TO "ViewbookFieldAmendment";
CREATE UNIQUE INDEX "ViewbookFieldAmendment_clientMutationId_key" ON "ViewbookFieldAmendment"("clientMutationId");
CREATE INDEX "ViewbookFieldAmendment_fieldId_id_idx" ON "ViewbookFieldAmendment"("fieldId", "id");
CREATE TABLE "new_ViewbookMaterialLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewbookId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'provided',
    "url" TEXT,
    "clientMutationId" TEXT,
    "addedBy" TEXT NOT NULL,
    "addedByKind" TEXT NOT NULL DEFAULT 'client',
    "providedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookMaterialLink_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ViewbookMaterialLink" ("addedBy", "clientMutationId", "createdAt", "id", "label", "providedAt", "status", "url", "viewbookId") SELECT "addedBy", "clientMutationId", "createdAt", "id", "label", "providedAt", "status", "url", "viewbookId" FROM "ViewbookMaterialLink";
DROP TABLE "ViewbookMaterialLink";
ALTER TABLE "new_ViewbookMaterialLink" RENAME TO "ViewbookMaterialLink";
CREATE UNIQUE INDEX "ViewbookMaterialLink_clientMutationId_key" ON "ViewbookMaterialLink"("clientMutationId");
CREATE INDEX "ViewbookMaterialLink_viewbookId_id_idx" ON "ViewbookMaterialLink"("viewbookId", "id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookAuthGrant_tokenHash_key" ON "ViewbookAuthGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "ViewbookAuthGrant_memberId_idx" ON "ViewbookAuthGrant"("memberId");

-- CreateIndex
CREATE INDEX "ViewbookAuthGrant_expiresAt_idx" ON "ViewbookAuthGrant"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookMemberSession_tokenHash_key" ON "ViewbookMemberSession"("tokenHash");

-- CreateIndex
CREATE INDEX "ViewbookMemberSession_memberId_idx" ON "ViewbookMemberSession"("memberId");

-- CreateIndex
CREATE INDEX "ViewbookMemberSession_expiresAt_idx" ON "ViewbookMemberSession"("expiresAt");

-- CreateIndex
CREATE INDEX "ViewbookAuthRequest_viewbookId_email_createdAt_idx" ON "ViewbookAuthRequest"("viewbookId", "email", "createdAt");

-- CreateIndex
CREATE INDEX "ViewbookAuthRequest_email_createdAt_idx" ON "ViewbookAuthRequest"("email", "createdAt");

-- CreateIndex
CREATE INDEX "ViewbookAuthRequest_createdAt_idx" ON "ViewbookAuthRequest"("createdAt");

-- Backfill durable attribution discriminators for pre-U1 rows.
UPDATE "ViewbookActivity" SET "actorKind" = 'operator' WHERE "actor" <> 'client';
UPDATE "ViewbookMaterialLink" SET "addedByKind" = 'operator' WHERE "addedBy" <> 'client';
UPDATE "ViewbookField" SET "valueUpdatedByKind" = CASE WHEN "valueUpdatedBy" = 'client' THEN 'client' ELSE 'operator' END WHERE "valueUpdatedBy" IS NOT NULL;
UPDATE "ViewbookFieldAmendment" SET "authorKind" = 'operator' WHERE "author" <> 'client';
