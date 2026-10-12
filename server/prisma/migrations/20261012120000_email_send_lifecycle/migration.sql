ALTER TABLE "EmailLog" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN "lastAttemptAt" TIMESTAMP(3);
UPDATE "EmailLog" SET "lastAttemptAt" = "createdAt" WHERE "status" IN ('SUCCESS', 'RETRIED', 'BOUNCED', 'COMPLAINED');
CREATE UNIQUE INDEX "EmailLog_accountId_idempotencyKey_key" ON "EmailLog"("accountId", "idempotencyKey");
-- Resuming a campaign after deployment must also deduplicate its earlier sends.
WITH sent AS (
    SELECT DISTINCT ON ("accountId", "sourceId", lower(trim("to"))) "id", "sourceId", lower(trim("to")) AS recipient
    FROM "EmailLog"
    WHERE "source" = 'CAMPAIGN' AND "sourceId" IS NOT NULL
      AND "status" IN ('SUCCESS', 'RETRIED', 'BOUNCED', 'COMPLAINED')
    ORDER BY "accountId", "sourceId", lower(trim("to")), "createdAt" DESC
)
UPDATE "EmailLog" AS log SET "idempotencyKey" = 'campaign:' || sent."sourceId" || ':' || sent.recipient
FROM sent WHERE log."id" = sent."id";
CREATE INDEX "EmailLog_accountId_lastAttemptAt_idx" ON "EmailLog"("accountId", "lastAttemptAt");
CREATE TABLE "EmailSendAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "emailLogId" TEXT NOT NULL REFERENCES "EmailLog"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EmailSendAttempt_accountId_createdAt_idx" ON "EmailSendAttempt"("accountId", "createdAt");
CREATE INDEX "EmailSendAttempt_emailLogId_idx" ON "EmailSendAttempt"("emailLogId");
INSERT INTO "EmailSendAttempt" ("id", "accountId", "emailLogId", "createdAt")
SELECT 'legacy-' || "id", "accountId", "id", "lastAttemptAt" FROM "EmailLog" WHERE "lastAttemptAt" IS NOT NULL;
