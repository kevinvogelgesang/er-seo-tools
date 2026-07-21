-- AlterTable
ALTER TABLE "CrawlRun" ADD COLUMN "anchorSummaryJson" TEXT;

-- AlterTable
ALTER TABLE "HarvestedLink" ADD COLUMN "anchorText" TEXT;
