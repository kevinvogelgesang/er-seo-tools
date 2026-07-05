-- C6 hybrid-discovery Increment 1: sitemap miss-rate measurement (additive, nullable).
ALTER TABLE "CrawlRun" ADD COLUMN "discoveryCoverageJson" TEXT;
ALTER TABLE "SiteAudit" ADD COLUMN "discoveryMode" TEXT;
ALTER TABLE "SiteAudit" ADD COLUMN "discoveryCapped" BOOLEAN;
