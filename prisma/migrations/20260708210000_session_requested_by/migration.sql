-- C16: session attribution for the unified recents Mine filter.
ALTER TABLE "Session" ADD COLUMN "requestedBy" TEXT;
CREATE INDEX "Session_requestedBy_createdAt_idx" ON "Session"("requestedBy", "createdAt");
