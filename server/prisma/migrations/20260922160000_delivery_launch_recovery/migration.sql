ALTER TABLE "ReceiptAccount" ADD COLUMN "revalidationRequested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ReceiptLegacyWork"
 ADD COLUMN "targets" JSONB,
 ADD COLUMN "reconciliation" JSONB,
 ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN "lastError" TEXT,
 ADD COLUMN "resolvedAt" TIMESTAMP(3);
CREATE INDEX "ReceiptLegacyWork_state_nextAttemptAt_idx" ON "ReceiptLegacyWork" ("state", "nextAttemptAt");
