-- C6 Phase 5: content similarity.
ALTER TABLE "HarvestedPageSeo" ADD COLUMN "contentText" TEXT;
ALTER TABLE "HarvestedPageSeo" ADD COLUMN "contentTruncated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CrawlRun" ADD COLUMN "contentSimilarityJson" TEXT;
