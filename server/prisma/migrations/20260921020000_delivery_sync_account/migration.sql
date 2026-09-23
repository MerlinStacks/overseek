CREATE TABLE "DeliverySyncAccount" (
  "accountId" TEXT NOT NULL PRIMARY KEY REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "capabilityStatus" TEXT NOT NULL DEFAULT 'unknown',
  "capabilityExpiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "hasWork" BOOLEAN NOT NULL DEFAULT true,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastServedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resyncRequested" BOOLEAN NOT NULL DEFAULT false,
  "resyncGeneration" INTEGER NOT NULL DEFAULT 0,
  "resyncPhase" TEXT NOT NULL DEFAULT 'products',
  "resyncCursor" TEXT,
  "lastBuildAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "buildAttempts" INTEGER NOT NULL DEFAULT 0,
  "buildNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "buildFailed" BOOLEAN NOT NULL DEFAULT false,
  "buildLastError" TEXT,
  "buildVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
ALTER TABLE "DeliveryInputSync" ADD COLUMN "resyncGeneration" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "DeliveryInputSync_accountId_status_nextAttemptAt_idx" ON "DeliveryInputSync"("accountId", "status", "nextAttemptAt");
CREATE INDEX "DeliveryInputSync_accountId_scope_id_idx" ON "DeliveryInputSync"("accountId", "scope", "id");
CREATE INDEX "DeliveryInputSync_dispatch_account_idx" ON "DeliveryInputSync"("accountId", "status", "priority", "nextAttemptAt");
CREATE INDEX "WooProduct_accountId_id_idx" ON "WooProduct"("accountId", "id");
CREATE INDEX "DeliverySyncAccount_dispatch_idx" ON "DeliverySyncAccount"("hasWork", "capabilityStatus", "nextAttemptAt", "lastServedAt");
CREATE INDEX "DeliverySyncAccount_resyncRequested_lastBuildAt_idx" ON "DeliverySyncAccount"("resyncRequested", "lastBuildAt");
CREATE INDEX "DeliverySyncAccount_build_due_idx" ON "DeliverySyncAccount"("resyncRequested", "buildFailed", "buildNextAttemptAt", "lastBuildAt");
-- Recovery metadata for already persisted intents only; no production/settings backfill.
INSERT INTO "DeliverySyncAccount" ("accountId", "updatedAt", "hasWork", "nextAttemptAt", "capabilityStatus", "lastError")
SELECT "accountId", CURRENT_TIMESTAMP, BOOL_OR("status" = 'pending'),
  COALESCE(MIN("nextAttemptAt") FILTER (WHERE "status" = 'pending'), CURRENT_TIMESTAMP),
  CASE WHEN BOOL_OR("status" = 'plugin_update_required') THEN 'plugin_update_required' ELSE 'unknown' END,
  CASE WHEN BOOL_OR("status" = 'plugin_update_required') THEN 'Update the Overseek WooCommerce plugin.' ELSE NULL END
FROM "DeliveryInputSync" GROUP BY "accountId";
