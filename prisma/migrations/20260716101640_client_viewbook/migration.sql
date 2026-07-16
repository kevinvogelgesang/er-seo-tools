-- CreateTable
CREATE TABLE "Viewbook" (
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
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Viewbook_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ViewbookSection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewbookId" INTEGER NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "doneAt" DATETIME,
    "introNote" TEXT,
    "narrative" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ViewbookSection_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ViewbookField" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewbookId" INTEGER NOT NULL,
    "defKey" TEXT,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "value" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "valueUpdatedBy" TEXT,
    "valueUpdatedAt" DATETIME,
    "archivedAt" DATETIME,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookField_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ViewbookFieldAmendment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fieldId" INTEGER NOT NULL,
    "value" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "clientMutationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookFieldAmendment_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ViewbookField" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ViewbookMilestone" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewbookId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "blurb" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "targetDate" DATETIME,
    "doneAt" DATETIME,
    CONSTRAINT "ViewbookMilestone_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ViewbookReviewLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "milestoneId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookReviewLink_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "ViewbookMilestone" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ViewbookFeedback" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reviewLinkId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "authorName" TEXT,
    "authorKind" TEXT NOT NULL,
    "clientMutationId" TEXT,
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookFeedback_reviewLinkId_fkey" FOREIGN KEY ("reviewLinkId") REFERENCES "ViewbookReviewLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ViewbookGlobalContent" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "bodyJson" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ViewbookContentOverride" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewbookId" INTEGER NOT NULL,
    "contentKey" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ViewbookContentOverride_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ViewbookMaterialLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewbookId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'provided',
    "url" TEXT,
    "clientMutationId" TEXT,
    "addedBy" TEXT NOT NULL,
    "providedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookMaterialLink_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ViewbookActivity" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewbookId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookActivity_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Viewbook_clientId_key" ON "Viewbook"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Viewbook_token_key" ON "Viewbook"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookSection_viewbookId_sectionKey_key" ON "ViewbookSection"("viewbookId", "sectionKey");

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookField_viewbookId_defKey_key" ON "ViewbookField"("viewbookId", "defKey");

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookFieldAmendment_clientMutationId_key" ON "ViewbookFieldAmendment"("clientMutationId");

-- CreateIndex
CREATE INDEX "ViewbookFieldAmendment_fieldId_id_idx" ON "ViewbookFieldAmendment"("fieldId", "id");

-- CreateIndex
CREATE INDEX "ViewbookMilestone_viewbookId_sortOrder_idx" ON "ViewbookMilestone"("viewbookId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookFeedback_clientMutationId_key" ON "ViewbookFeedback"("clientMutationId");

-- CreateIndex
CREATE INDEX "ViewbookFeedback_reviewLinkId_id_idx" ON "ViewbookFeedback"("reviewLinkId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookContentOverride_viewbookId_contentKey_key" ON "ViewbookContentOverride"("viewbookId", "contentKey");

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookMaterialLink_clientMutationId_key" ON "ViewbookMaterialLink"("clientMutationId");

-- CreateIndex
CREATE INDEX "ViewbookMaterialLink_viewbookId_id_idx" ON "ViewbookMaterialLink"("viewbookId", "id");

-- CreateIndex
CREATE INDEX "ViewbookActivity_viewbookId_id_idx" ON "ViewbookActivity"("viewbookId", "id");

-- At most one 'current' milestone per viewbook (spec §4 / Codex fix 5)
CREATE UNIQUE INDEX "ViewbookMilestone_one_current_per_viewbook"
ON "ViewbookMilestone"("viewbookId") WHERE "status" = 'current';
