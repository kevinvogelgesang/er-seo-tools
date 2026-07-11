ALTER TABLE "Client" ADD COLUMN "institutionType" TEXT;
ALTER TABLE "Client" ADD COLUMN "programsJson" TEXT;
ALTER TABLE "Client" ADD COLUMN "programSuggestionsJson" TEXT;
ALTER TABLE "Client" ADD COLUMN "kwLocationCode" INTEGER;
ALTER TABLE "Client" ADD COLUMN "kwLanguageCode" TEXT;
ALTER TABLE "Client" ADD COLUMN "kwMarketLabel" TEXT;
ALTER TABLE "CrawlRun" ADD COLUMN "programEntitiesJson" TEXT;
