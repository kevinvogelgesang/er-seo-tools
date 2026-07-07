-- roadmap 3b reachability graph: additive, nullable run-metadata column.
ALTER TABLE "CrawlRun" ADD COLUMN "reachabilityJson" TEXT;
