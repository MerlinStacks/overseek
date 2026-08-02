CREATE TABLE "SmsLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "from" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "errorCode" TEXT,
    "source" TEXT,
    "sourceId" TEXT,
    "messageId" TEXT,
    "segments" INTEGER,
    "price" TEXT,
    "priceUnit" TEXT,
    "statusAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SmsLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmsLog_messageId_key" ON "SmsLog"("messageId");
CREATE INDEX "SmsLog_accountId_createdAt_idx" ON "SmsLog"("accountId", "createdAt");
CREATE INDEX "SmsLog_accountId_status_idx" ON "SmsLog"("accountId", "status");
CREATE INDEX "SmsLog_source_sourceId_idx" ON "SmsLog"("source", "sourceId");

ALTER TABLE "SmsLog" ADD CONSTRAINT "SmsLog_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
