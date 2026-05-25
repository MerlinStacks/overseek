-- Repair schema drift for marketing automation analytics, email lists, and SMS settings.
-- These objects are present in schema.prisma and used by the API, but were missing
-- from earlier migration history in some environments.

-- Marketing automation columns added after the original automation migration.
ALTER TABLE "MarketingAutomation"
    ADD COLUMN IF NOT EXISTS "flowDefinition" JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PAUSED';

-- Broadcast list targeting support.
ALTER TABLE "MarketingCampaign"
    ADD COLUMN IF NOT EXISTS "designJson" JSONB,
    ADD COLUMN IF NOT EXISTS "listId" TEXT;

-- Automation enrollment fields used by the flow runner and analytics endpoints.
ALTER TABLE "AutomationEnrollment"
    ADD COLUMN IF NOT EXISTS "accountId" TEXT,
    ADD COLUMN IF NOT EXISTS "statusReason" TEXT,
    ADD COLUMN IF NOT EXISTS "lastProcessedNodeId" TEXT,
    ADD COLUMN IF NOT EXISTS "triggerEntityType" TEXT,
    ADD COLUMN IF NOT EXISTS "triggerEntityId" TEXT,
    ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT,
    ADD COLUMN IF NOT EXISTS "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "conversionAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "convertedOrderId" TEXT,
    ADD COLUMN IF NOT EXISTS "convertedRevenue" DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS "lastEmailLogId" TEXT;

UPDATE "AutomationEnrollment" e
SET "accountId" = a."accountId"
FROM "MarketingAutomation" a
WHERE e."automationId" = a."id"
  AND e."accountId" IS NULL;

ALTER TABLE "AutomationEnrollment" ALTER COLUMN "accountId" SET NOT NULL;

-- Curated broadcast email lists.
CREATE TABLE IF NOT EXISTS "EmailList" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EmailListMember" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "wooCustomerId" TEXT,
    "isSubscribed" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT,
    "subscribedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailListMember_pkey" PRIMARY KEY ("id")
);

-- Automation execution analytics.
CREATE TABLE IF NOT EXISTS "AutomationRunEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "nodeId" TEXT,
    "eventType" TEXT NOT NULL,
    "outcome" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationRunEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutomationGoalEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "goalType" TEXT NOT NULL,
    "orderId" TEXT,
    "revenue" DECIMAL(10,2),
    "attributionWindowHours" INTEGER NOT NULL DEFAULT 168,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationGoalEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GeneratedCoupon" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "wooCouponId" INTEGER,
    "code" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "discountType" TEXT NOT NULL,
    "description" TEXT,
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "orderId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GeneratedCoupon_pkey" PRIMARY KEY ("id")
);

-- Per-account Twilio configuration used by /api/sms/settings.
CREATE TABLE IF NOT EXISTS "SmsSettings" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountSid" TEXT NOT NULL,
    "authToken" TEXT NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "smsCostPerSegment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SmsSettings_pkey" PRIMARY KEY ("id")
);

-- Indexes and unique constraints.
CREATE UNIQUE INDEX IF NOT EXISTS "EmailList_accountId_name_key" ON "EmailList"("accountId", "name");
CREATE INDEX IF NOT EXISTS "EmailList_accountId_isActive_idx" ON "EmailList"("accountId", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "EmailListMember_listId_email_key" ON "EmailListMember"("listId", "email");
CREATE INDEX IF NOT EXISTS "EmailListMember_accountId_email_idx" ON "EmailListMember"("accountId", "email");
CREATE INDEX IF NOT EXISTS "EmailListMember_accountId_listId_isSubscribed_idx" ON "EmailListMember"("accountId", "listId", "isSubscribed");
CREATE INDEX IF NOT EXISTS "AutomationEnrollment_accountId_status_nextRunAt_idx" ON "AutomationEnrollment"("accountId", "status", "nextRunAt");
CREATE INDEX IF NOT EXISTS "AutomationEnrollment_accountId_email_status_idx" ON "AutomationEnrollment"("accountId", "email", "status");
CREATE INDEX IF NOT EXISTS "AutomationEnrollment_accountId_triggerEntityType_triggerEntityId_idx" ON "AutomationEnrollment"("accountId", "triggerEntityType", "triggerEntityId");
CREATE INDEX IF NOT EXISTS "AutomationEnrollment_accountId_dedupeKey_idx" ON "AutomationEnrollment"("accountId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "AutomationRunEvent_accountId_automationId_createdAt_idx" ON "AutomationRunEvent"("accountId", "automationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AutomationRunEvent_accountId_enrollmentId_createdAt_idx" ON "AutomationRunEvent"("accountId", "enrollmentId", "createdAt");
CREATE INDEX IF NOT EXISTS "AutomationRunEvent_automationId_nodeId_createdAt_idx" ON "AutomationRunEvent"("automationId", "nodeId", "createdAt");
CREATE INDEX IF NOT EXISTS "AutomationGoalEvent_accountId_automationId_createdAt_idx" ON "AutomationGoalEvent"("accountId", "automationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AutomationGoalEvent_accountId_enrollmentId_createdAt_idx" ON "AutomationGoalEvent"("accountId", "enrollmentId", "createdAt");
CREATE INDEX IF NOT EXISTS "AutomationGoalEvent_accountId_orderId_idx" ON "AutomationGoalEvent"("accountId", "orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "GeneratedCoupon_accountId_code_key" ON "GeneratedCoupon"("accountId", "code");
CREATE INDEX IF NOT EXISTS "GeneratedCoupon_accountId_automationId_createdAt_idx" ON "GeneratedCoupon"("accountId", "automationId", "createdAt");
CREATE INDEX IF NOT EXISTS "GeneratedCoupon_accountId_enrollmentId_createdAt_idx" ON "GeneratedCoupon"("accountId", "enrollmentId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "SmsSettings_accountId_key" ON "SmsSettings"("accountId");

-- Foreign keys. PostgreSQL does not support ADD CONSTRAINT IF NOT EXISTS, so guard each one.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutomationEnrollment_accountId_fkey') THEN
        ALTER TABLE "AutomationEnrollment" ADD CONSTRAINT "AutomationEnrollment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MarketingCampaign_listId_fkey') THEN
        ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_listId_fkey" FOREIGN KEY ("listId") REFERENCES "EmailList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmailList_accountId_fkey') THEN
        ALTER TABLE "EmailList" ADD CONSTRAINT "EmailList_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmailListMember_accountId_fkey') THEN
        ALTER TABLE "EmailListMember" ADD CONSTRAINT "EmailListMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmailListMember_listId_fkey') THEN
        ALTER TABLE "EmailListMember" ADD CONSTRAINT "EmailListMember_listId_fkey" FOREIGN KEY ("listId") REFERENCES "EmailList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmailListMember_wooCustomerId_fkey') THEN
        ALTER TABLE "EmailListMember" ADD CONSTRAINT "EmailListMember_wooCustomerId_fkey" FOREIGN KEY ("wooCustomerId") REFERENCES "WooCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutomationRunEvent_accountId_fkey') THEN
        ALTER TABLE "AutomationRunEvent" ADD CONSTRAINT "AutomationRunEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutomationRunEvent_automationId_fkey') THEN
        ALTER TABLE "AutomationRunEvent" ADD CONSTRAINT "AutomationRunEvent_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "MarketingAutomation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutomationRunEvent_enrollmentId_fkey') THEN
        ALTER TABLE "AutomationRunEvent" ADD CONSTRAINT "AutomationRunEvent_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "AutomationEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutomationGoalEvent_accountId_fkey') THEN
        ALTER TABLE "AutomationGoalEvent" ADD CONSTRAINT "AutomationGoalEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutomationGoalEvent_automationId_fkey') THEN
        ALTER TABLE "AutomationGoalEvent" ADD CONSTRAINT "AutomationGoalEvent_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "MarketingAutomation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutomationGoalEvent_enrollmentId_fkey') THEN
        ALTER TABLE "AutomationGoalEvent" ADD CONSTRAINT "AutomationGoalEvent_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "AutomationEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GeneratedCoupon_accountId_fkey') THEN
        ALTER TABLE "GeneratedCoupon" ADD CONSTRAINT "GeneratedCoupon_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GeneratedCoupon_automationId_fkey') THEN
        ALTER TABLE "GeneratedCoupon" ADD CONSTRAINT "GeneratedCoupon_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "MarketingAutomation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GeneratedCoupon_enrollmentId_fkey') THEN
        ALTER TABLE "GeneratedCoupon" ADD CONSTRAINT "GeneratedCoupon_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "AutomationEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SmsSettings_accountId_fkey') THEN
        ALTER TABLE "SmsSettings" ADD CONSTRAINT "SmsSettings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
