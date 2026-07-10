-- CreateTable
CREATE TABLE "AdaScoringWeights" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "critical" REAL NOT NULL DEFAULT 40,
    "serious" REAL NOT NULL DEFAULT 30,
    "moderate" REAL NOT NULL DEFAULT 15,
    "minor" REAL NOT NULL DEFAULT 5,
    "needsReview" REAL NOT NULL DEFAULT 10,
    "advisoryDiscount" REAL NOT NULL DEFAULT 0.4,
    "updatedAt" DATETIME NOT NULL
);

-- AlterTable
ALTER TABLE "ScoringWeights" ADD COLUMN "brokenLinks" REAL NOT NULL DEFAULT 10;
