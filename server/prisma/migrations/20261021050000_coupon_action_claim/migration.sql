ALTER TABLE "GeneratedCoupon" ADD COLUMN "nodeId" TEXT;
ALTER TABLE "GeneratedCoupon" ADD COLUMN "creationClaimed" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "GeneratedCoupon_accountId_enrollmentId_nodeId_key" ON "GeneratedCoupon"("accountId", "enrollmentId", "nodeId");
