CREATE TYPE "ReceiptTransportMode" AS ENUM ('LEGACY', 'GUARDED');
ALTER TABLE "Account" ADD COLUMN "receiptTransportMode" "ReceiptTransportMode" NOT NULL DEFAULT 'LEGACY';
CREATE TABLE "ReceiptAccount" (
  "accountId" TEXT PRIMARY KEY REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "capability" TEXT NOT NULL DEFAULT 'unknown', "capabilityExpiresAt" TIMESTAMP(3),
  "capabilityAttempts" INTEGER NOT NULL DEFAULT 0 CHECK ("capabilityAttempts" >= 0),
  "capabilityNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT, "leaseExpiresAt" TIMESTAMP(3), "lastServedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastError" TEXT
);
CREATE INDEX "ReceiptAccount_capability_due_idx" ON "ReceiptAccount"("capability", "capabilityNextAttemptAt", "lastServedAt");
CREATE TABLE "ReceiptOwner" (
  "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "stockOwnerWooId" INTEGER NOT NULL CHECK ("stockOwnerWooId" > 0),
  "lastSequence" BIGINT NOT NULL DEFAULT 0 CHECK ("lastSequence" BETWEEN 0 AND 9007199254740991),
  "appliedSequence" BIGINT NOT NULL DEFAULT 0 CHECK ("appliedSequence" BETWEEN 0 AND "lastSequence"),
  "leaseToken" TEXT, "leaseExpiresAt" TIMESTAMP(3), "parked" BOOLEAN NOT NULL DEFAULT false,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("accountId", "stockOwnerWooId")
);
CREATE INDEX "ReceiptOwner_parked_nextAttemptAt_idx" ON "ReceiptOwner"("parked", "nextAttemptAt");
CREATE TABLE "ReceiptCycle" (
  "id" TEXT PRIMARY KEY, "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "purchaseOrderId" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ReceiptCycle_accountId_purchaseOrderId_active_idx" ON "ReceiptCycle"("accountId", "purchaseOrderId", "active");
CREATE UNIQUE INDEX "ReceiptCycle_active_po_key" ON "ReceiptCycle"("accountId", "purchaseOrderId") WHERE "active";
CREATE TABLE "ReceiptOperation" (
  "operationId" TEXT PRIMARY KEY CHECK ("operationId" ~ '^[A-Za-z0-9_-]{1,128}$'),
  "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "cycleId" TEXT NOT NULL REFERENCES "ReceiptCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "purchaseOrderId" TEXT NOT NULL, "productId" TEXT NOT NULL, "variationId" TEXT,
  "productWooId" INTEGER NOT NULL CHECK ("productWooId" > 0), "variationWooId" INTEGER,
  "stockOwnerWooId" INTEGER NOT NULL, "sequence" BIGINT NOT NULL CHECK ("sequence" BETWEEN 1 AND 9007199254740991),
  "delta" INTEGER NOT NULL CHECK ("delta" <> 0 AND "delta" BETWEEN -1000000 AND 1000000),
  "state" TEXT NOT NULL DEFAULT 'pending', "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastError" TEXT, "stockQuantity" DOUBLE PRECISION,
  "appliedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("accountId", "stockOwnerWooId") REFERENCES "ReceiptOwner"("accountId", "stockOwnerWooId") ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK (("variationWooId" IS NULL AND "stockOwnerWooId" = "productWooId" AND "variationId" IS NULL) OR
    ("variationWooId" > 0 AND "variationWooId" <> "productWooId" AND "stockOwnerWooId" = "variationWooId" AND "variationId" IS NOT NULL))
);
CREATE UNIQUE INDEX "ReceiptOperation_accountId_stockOwnerWooId_sequence_key" ON "ReceiptOperation"("accountId", "stockOwnerWooId", "sequence");
CREATE INDEX "ReceiptOperation_accountId_purchaseOrderId_idx" ON "ReceiptOperation"("accountId", "purchaseOrderId");
CREATE INDEX "ReceiptOperation_cycleId_idx" ON "ReceiptOperation"("cycleId");
-- Status/attempt metadata can change; receipt intent and original local targets cannot.
CREATE FUNCTION protect_receipt_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."operationId", NEW."accountId", NEW."cycleId", NEW."purchaseOrderId", NEW."productId", NEW."variationId", NEW."productWooId", NEW."variationWooId", NEW."stockOwnerWooId", NEW."sequence", NEW."delta", NEW."createdAt")
    IS DISTINCT FROM ROW(OLD."operationId", OLD."accountId", OLD."cycleId", OLD."purchaseOrderId", OLD."productId", OLD."variationId", OLD."productWooId", OLD."variationWooId", OLD."stockOwnerWooId", OLD."sequence", OLD."delta", OLD."createdAt") THEN
    RAISE EXCEPTION 'Receipt operation intent is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER receipt_operation_immutable BEFORE UPDATE ON "ReceiptOperation" FOR EACH ROW EXECUTE FUNCTION protect_receipt_operation();
