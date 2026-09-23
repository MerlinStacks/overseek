ALTER TABLE "DeliveryInputSync" ADD COLUMN "inboundGeneration" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DeliverySyncAccount"
  ADD COLUMN "inboundCapabilityStatus" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN "inboundRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "inboundGeneration" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inboundBuildGeneration" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inboundPhase" TEXT NOT NULL DEFAULT 'products',
  ADD COLUMN "inboundCursor" TEXT,
  ADD COLUMN "inboundAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inboundFailed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "inboundNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "inboundLastBuildAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "inboundVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inboundLastError" TEXT;
CREATE INDEX "DeliverySyncAccount_inbound_due_idx" ON "DeliverySyncAccount" ("inboundRequested", "inboundFailed", "inboundNextAttemptAt", "inboundLastBuildAt");
CREATE INDEX "PurchaseOrderItem_productId_purchaseOrderId_idx" ON "PurchaseOrderItem" ("productId", "purchaseOrderId");
