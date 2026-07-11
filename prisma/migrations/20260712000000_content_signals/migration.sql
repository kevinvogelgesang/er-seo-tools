-- C12 Increment B: additive nullable content-signals metadata on CrawlRun.
ALTER TABLE "CrawlRun" ADD COLUMN "contentSignalsJson" TEXT;
