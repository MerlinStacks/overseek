-- Backfill existing rows with current timestamp, then set default
UPDATE "CompetitorDomain" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;
ALTER TABLE "CompetitorDomain" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
