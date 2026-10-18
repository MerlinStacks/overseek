ALTER TABLE "AudienceSync"
ADD COLUMN "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "consentConfirmedAt" TIMESTAMP(3),
ADD COLUMN "syncedEmailHashes" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "lastAttemptAt" TIMESTAMP(3);
