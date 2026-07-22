ALTER TABLE "ConversionDelivery" ADD COLUMN "lastAttemptAt" TIMESTAMP(3);

ALTER TABLE "AnalyticsEvent" ADD COLUMN "occurredAt" TIMESTAMP(3);
UPDATE "AnalyticsEvent" SET "occurredAt" = "createdAt" WHERE "occurredAt" IS NULL;
ALTER TABLE "AnalyticsEvent" ALTER COLUMN "occurredAt" SET NOT NULL;
ALTER TABLE "AnalyticsEvent" ALTER COLUMN "occurredAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "ConversionEventReceipt" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversionEventReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversionEventReceipt_accountId_eventId_key"
    ON "ConversionEventReceipt"("accountId", "eventId");
CREATE INDEX "ConversionEventReceipt_createdAt_idx" ON "ConversionEventReceipt"("createdAt");
