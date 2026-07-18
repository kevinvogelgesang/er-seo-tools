-- CreateTable
CREATE TABLE "ViewbookAssessmentContent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "viewbookId" INTEGER NOT NULL,
    "generalNotesHtml" TEXT,
    "userBehaviourHtml" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "updatedBy" TEXT,
    CONSTRAINT "ViewbookAssessmentContent_viewbookId_fkey" FOREIGN KEY ("viewbookId") REFERENCES "Viewbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ViewbookAssessmentImage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contentId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookAssessmentImage_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ViewbookAssessmentContent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookAssessmentContent_viewbookId_key" ON "ViewbookAssessmentContent"("viewbookId");

-- CreateIndex
CREATE INDEX "ViewbookAssessmentImage_contentId_sortOrder_idx" ON "ViewbookAssessmentImage"("contentId", "sortOrder");
