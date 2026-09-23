CREATE TABLE "DeliveryInputSync" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "scope" TEXT NOT NULL CHECK ("scope" IN ('settings', 'product')),
  "entityId" INTEGER NOT NULL,
  "desiredRevision" BIGINT NOT NULL DEFAULT 1 CHECK ("desiredRevision" BETWEEN 1 AND 9007199254740991),
  "ackRevision" BIGINT NOT NULL DEFAULT 0 CHECK ("ackRevision" >= 0 AND "ackRevision" <= "desiredRevision"),
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "priority" INTEGER NOT NULL DEFAULT 1,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "lastAcknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CHECK (("scope" = 'settings' AND "entityId" = 0) OR ("scope" = 'product' AND "entityId" > 0)),
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DeliveryInputSync_accountId_scope_entityId_key" ON "DeliveryInputSync"("accountId", "scope", "entityId");
CREATE INDEX "DeliveryInputSync_accountId_idx" ON "DeliveryInputSync"("accountId");
CREATE INDEX "DeliveryInputSync_status_priority_nextAttemptAt_idx" ON "DeliveryInputSync"("status", "priority", "nextAttemptAt");
