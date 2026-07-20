-- CreateTable
CREATE TABLE "ViewbookFeedbackImage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "feedbackId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ViewbookFeedbackImage_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "ViewbookFeedback" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ViewbookFeedbackImage_feedbackId_sortOrder_idx" ON "ViewbookFeedbackImage"("feedbackId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ViewbookFeedbackImage_feedbackId_sortOrder_key" ON "ViewbookFeedbackImage"("feedbackId", "sortOrder");
