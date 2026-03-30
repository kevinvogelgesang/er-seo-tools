-- CreateTable
CREATE TABLE "AdaAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "result" TEXT,
    "clientId" INTEGER,
    CONSTRAINT "AdaAudit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AdaAudit_createdAt_idx" ON "AdaAudit"("createdAt");

-- CreateIndex
CREATE INDEX "AdaAudit_clientId_idx" ON "AdaAudit"("clientId");

-- CreateIndex
CREATE INDEX "AdaAudit_status_idx" ON "AdaAudit"("status");
