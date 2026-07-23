-- CreateTable
CREATE TABLE "SectionTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "templateKey" TEXT NOT NULL,
    "rendererType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "copyJson" TEXT NOT NULL,
    "contentJson" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SubsectionTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sectionTemplateId" INTEGER NOT NULL,
    "subsectionKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "offeringWebsite" BOOLEAN NOT NULL DEFAULT false,
    "offeringVa" BOOLEAN NOT NULL DEFAULT false,
    "offeringPpc" BOOLEAN NOT NULL DEFAULT false,
    "copyJson" TEXT,
    "contentJson" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubsectionTemplate_sectionTemplateId_fkey" FOREIGN KEY ("sectionTemplateId") REFERENCES "SectionTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FieldTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "subsectionTemplateId" INTEGER NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FieldTemplate_subsectionTemplateId_fkey" FOREIGN KEY ("subsectionTemplateId") REFERENCES "SubsectionTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SectionTemplate_templateKey_key" ON "SectionTemplate"("templateKey");

-- CreateIndex
CREATE UNIQUE INDEX "SubsectionTemplate_sectionTemplateId_subsectionKey_key" ON "SubsectionTemplate"("sectionTemplateId", "subsectionKey");

-- CreateIndex
CREATE UNIQUE INDEX "FieldTemplate_fieldKey_key" ON "FieldTemplate"("fieldKey");
