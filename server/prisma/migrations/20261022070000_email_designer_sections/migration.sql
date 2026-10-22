CREATE TABLE "EmailSectionPreset" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "section" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailSectionPreset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailSectionPreset_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EmailSectionPreset_accountId_updatedAt_idx" ON "EmailSectionPreset"("accountId", "updatedAt");
