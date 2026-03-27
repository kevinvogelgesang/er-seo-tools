-- CreateTable
CREATE TABLE "Client" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "domains" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_name_key" ON "Client"("name");

-- AlterTable: add clientId to Session
ALTER TABLE "Session" ADD COLUMN "clientId" INTEGER REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Session_clientId_idx" ON "Session"("clientId");

-- Seed default clients
INSERT INTO "Client" ("name") VALUES
('Beal University'),
('BEONAIR (M & S Media Inc.)'),
('Bidwell Training Center'),
('Boca Beauty Academy'),
('Brockway Center for Arts and Technology'),
('Brownson Technical School'),
('Federico Beauty Institute'),
('Florida Education Institute (FEI)'),
('Healthcare Career College'),
('Hilbert College'),
('Innovate Salon Academy'),
('Manhattan School of Computer Technology'),
('Milan Institute'),
('New York Institute of Massage'),
('Nuvani Institute'),
('Penrose Academy'),
('Prism Career Institute'),
('San Diego Global Knowledge University'),
('Southwest Schools'),
('Sutter County Career Training Center'),
('The College of Westchester'),
('The Soma Institute'),
('Urban River Massage Therapy School'),
('Valley College'),
('Wellspring School of Allied Health'),
('Discovery Community College'),
('Canadian College of Health Science & Technology'),
('Canadian College of Business, Science & Technology'),
('Cambria College'),
('Glow College of Artistic Design');
