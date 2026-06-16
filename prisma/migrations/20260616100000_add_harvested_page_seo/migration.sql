-- CreateTable
CREATE TABLE "HarvestedPageSeo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteAuditId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "statusCode" INTEGER,
    "isHtml" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT,
    "titleLength" INTEGER,
    "metaDescription" TEXT,
    "metaDescriptionLength" INTEGER,
    "h1" TEXT,
    "h1Count" INTEGER,
    "h2Count" INTEGER,
    "wordCount" INTEGER,
    "canonicalUrl" TEXT,
    "robotsNoindex" BOOLEAN NOT NULL DEFAULT false,
    "xRobotsNoindex" BOOLEAN NOT NULL DEFAULT false,
    "loginLike" BOOLEAN NOT NULL DEFAULT false,
    "schemaCount" INTEGER,
    "imageCount" INTEGER,
    "imagesMissingAlt" INTEGER,
    "imagesMissingDimensions" INTEGER,
    "harvestTruncated" BOOLEAN NOT NULL DEFAULT false,
    "detailsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HarvestedPageSeo_siteAuditId_fkey" FOREIGN KEY ("siteAuditId") REFERENCES "SiteAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "HarvestedPageSeo_siteAuditId_idx" ON "HarvestedPageSeo"("siteAuditId");
CREATE INDEX "HarvestedPageSeo_siteAuditId_url_idx" ON "HarvestedPageSeo"("siteAuditId", "url");
