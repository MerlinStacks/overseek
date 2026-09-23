ALTER TABLE "ReceiptOwner" ADD COLUMN "cascadePending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ReceiptAccount" ADD COLUMN "cascadeLeaseToken" TEXT, ADD COLUMN "cascadeLeaseExpiresAt" TIMESTAMP(3), ADD COLUMN "cascadeLastServedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ReceiptCycle" ADD COLUMN "skippedLines" JSONB;
ALTER TABLE "ReceiptLegacyWork" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'purchase_order', ADD COLUMN "sourceId" TEXT;
ALTER TABLE "BOMDeductionLedger" ADD COLUMN "guardedOperationId" TEXT, ADD COLUMN "guardedReversalOperationId" TEXT;
ALTER TABLE "ReceiptOperation"
 ADD COLUMN "cascadeState" TEXT NOT NULL DEFAULT 'done',
 ADD COLUMN "cascadeAttempts" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "cascadeNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN "cascadeError" TEXT,
 ADD COLUMN "cascadeCompletedAt" TIMESTAMP(3);
ALTER TABLE "ReceiptOperation" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'purchase_order', ADD COLUMN "sourceId" TEXT;
-- Existing unfinished deltas also need post-settlement cascade work. Historical
-- settled operations keep their ledger state and are not retrospectively replayed.
UPDATE "ReceiptOperation" SET "cascadeState" = 'waiting_receipt' WHERE state NOT IN ('applied','reconciled');
CREATE INDEX "ReceiptOperation_cascadeState_cascadeNextAttemptAt_idx" ON "ReceiptOperation" ("cascadeState", "cascadeNextAttemptAt");

-- The initial receipt CHECK only allowed independently-managed variations.
-- Keep immutable intent protection, but admit the real parent-owned shape too.
DO $$ DECLARE c RECORD;
BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='"ReceiptOperation"'::regclass AND contype='c'
   AND pg_get_constraintdef(oid) LIKE '%"variationId"%'
   AND pg_get_constraintdef(oid) LIKE '%"stockOwnerWooId"%'
 LOOP EXECUTE format('ALTER TABLE "ReceiptOperation" DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;
ALTER TABLE "ReceiptOperation" ADD CONSTRAINT "ReceiptOperation_native_owner_check" CHECK (
 ("variationWooId" IS NULL AND "stockOwnerWooId"="productWooId" AND "variationId" IS NULL)
 OR ("variationWooId" IS NOT NULL AND "variationWooId">0 AND "variationWooId"<>"productWooId" AND (
   ("stockOwnerWooId"="variationWooId" AND "variationId" IS NOT NULL)
   OR ("stockOwnerWooId"="productWooId" AND "variationId" IS NULL)
 ))
);
CREATE FUNCTION protect_receipt_cycle_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW."accountId",NEW."purchaseOrderId",NEW."skippedLines",NEW."createdAt")
   IS DISTINCT FROM ROW(OLD.id,OLD."accountId",OLD."purchaseOrderId",OLD."skippedLines",OLD."createdAt") THEN
   RAISE EXCEPTION 'Receipt cycle provenance is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER receipt_cycle_provenance_immutable BEFORE UPDATE ON "ReceiptCycle" FOR EACH ROW EXECUTE FUNCTION protect_receipt_cycle_provenance();
CREATE FUNCTION protect_receipt_operation_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."sourceType",NEW."sourceId") IS DISTINCT FROM ROW(OLD."sourceType",OLD."sourceId") THEN
   RAISE EXCEPTION 'Receipt operation source is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER receipt_operation_source_immutable BEFORE UPDATE ON "ReceiptOperation" FOR EACH ROW EXECUTE FUNCTION protect_receipt_operation_source();
