-- CreateTable
CREATE TABLE "QuarterPlan" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL DEFAULT 'Quarter plan',
    "startDate" TEXT,
    "slotsPerWeek" INTEGER NOT NULL DEFAULT 2,
    "layouts" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "QuarterAssignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "planId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "week" INTEGER,
    "position" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "note" TEXT NOT NULL DEFAULT '',
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuarterAssignment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "QuarterPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuarterAssignment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "QuarterAssignment_clientId_idx" ON "QuarterAssignment"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "QuarterAssignment_planId_clientId_key" ON "QuarterAssignment"("planId", "clientId");

