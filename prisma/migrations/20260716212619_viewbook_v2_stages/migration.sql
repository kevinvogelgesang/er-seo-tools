-- AlterTable
ALTER TABLE "Viewbook" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'post-contract';
ALTER TABLE "Viewbook" ADD COLUMN "syncVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Viewbook" ADD COLUMN "csmName" TEXT;
ALTER TABLE "Viewbook" ADD COLUMN "clientNotifyJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Viewbook" ADD COLUMN "pcCompletedAt" DATETIME;

-- AlterTable
ALTER TABLE "ViewbookSection" ADD COLUMN "acknowledgedAt" DATETIME;

-- CreateTable
CREATE TABLE "ViewbookTeamMember" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewbookId" INTEGER NOT NULL,
    "memberKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "clientMutationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookTeamMember_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ViewbookStageLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewbookId" INTEGER NOT NULL,
    "eventKey" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookStageLog_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ViewbookEmailDelivery" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewbookId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "memberId" INTEGER,
    "stageLogId" INTEGER,
    "sentAt" DATETIME,
    "suppressedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookEmailDelivery_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ViewbookDoc" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewbookId" INTEGER,
    "title" TEXT NOT NULL,
    "blurb" TEXT,
    "filename" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookDoc_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookTeamMember_memberKey_key" ON "ViewbookTeamMember"("memberKey");

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookTeamMember_clientMutationId_key" ON "ViewbookTeamMember"("clientMutationId");

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookTeamMember_viewbookId_email_key" ON "ViewbookTeamMember"("viewbookId", "email");

-- CreateIndex
CREATE INDEX "ViewbookTeamMember_viewbookId_id_idx" ON "ViewbookTeamMember"("viewbookId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookStageLog_eventKey_key" ON "ViewbookStageLog"("eventKey");

-- CreateIndex
CREATE INDEX "ViewbookStageLog_viewbookId_id_idx" ON "ViewbookStageLog"("viewbookId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookEmailDelivery_dedupKey_key" ON "ViewbookEmailDelivery"("dedupKey");

-- CreateIndex
CREATE INDEX "ViewbookEmailDelivery_viewbookId_id_idx" ON "ViewbookEmailDelivery"("viewbookId", "id");

-- CreateIndex
CREATE INDEX "ViewbookEmailDelivery_memberId_idx" ON "ViewbookEmailDelivery"("memberId");

-- CreateIndex
CREATE INDEX "ViewbookDoc_viewbookId_sortOrder_idx" ON "ViewbookDoc"("viewbookId", "sortOrder");

-- v2 backfill: existing viewbooks land in 'building' (spec §2 migration row);
-- updatedAt set manually — raw SQL bypasses @updatedAt
UPDATE "Viewbook" SET "stage" = 'building',
  "updatedAt" = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER);

-- Seed the six new section rows for every existing viewbook (idempotent,
-- updatedAt populated explicitly — raw SQL bypasses @updatedAt)
INSERT INTO "ViewbookSection" ("viewbookId", "sectionKey", "state", "updatedAt")
SELECT v."id", k."key", 'active', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM "Viewbook" v
CROSS JOIN (
  SELECT 'pc-intro' AS "key" UNION ALL SELECT 'pc-setup' UNION ALL
  SELECT 'pc-invite' UNION ALL SELECT 'pc-thanks' UNION ALL
  SELECT 'kickoff-next' UNION ALL SELECT 'ws-intro'
) k
WHERE NOT EXISTS (
  SELECT 1 FROM "ViewbookSection" s
  WHERE s."viewbookId" = v."id" AND s."sectionKey" = k."key"
);
