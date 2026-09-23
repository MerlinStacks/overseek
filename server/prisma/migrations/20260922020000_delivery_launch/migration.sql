ALTER TABLE "ReceiptAccount"
 ADD COLUMN "cutoverEpoch" TEXT,
 ADD COLUMN "cutoverState" TEXT NOT NULL DEFAULT 'legacy',
 ADD COLUMN "receivingFrozen" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "workersRestartedBy" TEXT,
 ADD COLUMN "workersRestartedAt" TIMESTAMP(3),
 ADD COLUMN "controlRevision" BIGINT NOT NULL DEFAULT 0,
 ADD COLUMN "controlAckRevision" BIGINT NOT NULL DEFAULT 0,
 ADD COLUMN "desiredActive" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "controlAction" TEXT,
 ADD COLUMN "controlCursor" TEXT,
 ADD COLUMN "controlPayload" JSONB,
 ADD COLUMN "controlAttempts" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "controlNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN "controlLeaseToken" TEXT,
 ADD COLUMN "controlLeaseExpiresAt" TIMESTAMP(3),
 ADD COLUMN "controlError" TEXT,
 ADD COLUMN "pluginReadiness" JSONB;
ALTER TABLE "ReceiptOwner" ADD COLUMN "certifiedEpoch" TEXT;
ALTER TABLE "ReceiptOperation" ADD COLUMN "reconciliation" JSONB;
ALTER TABLE "DeliveryInputSync" ADD COLUMN "proofRebuilds" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "ReceiptAccount_control_due_idx" ON "ReceiptAccount" ("controlAction", "controlNextAttemptAt");
CREATE TABLE "ReceiptLegacyWork" (
 "id" TEXT PRIMARY KEY, "accountId" TEXT NOT NULL REFERENCES "ReceiptAccount"("accountId") ON DELETE CASCADE,
 "purchaseOrderId" TEXT NOT NULL, "state" TEXT NOT NULL DEFAULT 'pending', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ReceiptLegacyWork_accountId_state_idx" ON "ReceiptLegacyWork" ("accountId", "state");
CREATE INDEX "ReceiptOperation_state_nextAttemptAt_idx" ON "ReceiptOperation" ("state", "nextAttemptAt");
CREATE INDEX "ReceiptOperation_accountId_state_idx" ON "ReceiptOperation" ("accountId", "state");
