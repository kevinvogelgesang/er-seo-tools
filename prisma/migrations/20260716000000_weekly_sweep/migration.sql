CREATE TABLE "WeeklySweep" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scheduledFor" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "membershipJson" TEXT,
    "fanoutCompletedAt" DATETIME,
    "snapshotJson" TEXT,
    "snapshotAt" DATETIME,
    "digestSentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "WeeklySweep_scheduledFor_key" ON "WeeklySweep"("scheduledFor");
