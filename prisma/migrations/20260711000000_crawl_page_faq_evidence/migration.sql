-- KS-4: per-page tri-state FAQ evidence. NULL = unknown (pre-KS-4 rows stay unknown forever — never backfill).
ALTER TABLE "CrawlPage" ADD COLUMN "faqEvidence" TEXT;
