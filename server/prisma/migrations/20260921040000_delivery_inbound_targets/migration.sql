ALTER TABLE "DeliverySyncAccount" ADD COLUMN "inboundFullRequested" BOOLEAN NOT NULL DEFAULT false;
-- Preserve previously queued account rebuilds during deployment.
UPDATE "DeliverySyncAccount" SET "inboundFullRequested" = true WHERE "inboundRequested" = true;
CREATE TABLE "DeliveryInboundDirtyTarget" (
  "accountId" TEXT NOT NULL,
  "wooId" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryInboundDirtyTarget_pkey" PRIMARY KEY ("accountId", "wooId"),
  CONSTRAINT "DeliveryInboundDirtyTarget_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DeliveryInboundDirtyTarget_accountId_createdAt_wooId_idx" ON "DeliveryInboundDirtyTarget"("accountId", "createdAt", "wooId");
