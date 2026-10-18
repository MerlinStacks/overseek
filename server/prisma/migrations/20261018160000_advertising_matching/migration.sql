ALTER TABLE "AudienceSync"
    ADD COLUMN "syncedIdentifiers" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "includeSubscribers" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "enhancedMatching" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "lastFullRefreshAt" TIMESTAMP(3);

CREATE INDEX "EmailLog_accountId_lower_to_idx" ON "EmailLog" ("accountId", lower(trim("to")));
CREATE INDEX "MessageTrackingEvent_emailLogId_eventType_createdAt_idx" ON "MessageTrackingEvent" ("emailLogId", "eventType", "createdAt");
