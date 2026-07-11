-- C12 Tier-1: additive nullable column for semantic topic-overlap clusters (live-scan runs only).
ALTER TABLE "CrawlRun" ADD COLUMN "topicOverlapJson" TEXT;
