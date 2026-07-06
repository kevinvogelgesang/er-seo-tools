-- Additive nullable column; no table rebuild needed (SQLite).
ALTER TABLE "SiteAudit" ADD COLUMN "discoverySourcesJson" TEXT;
