-- Local-only inputs: deliberately no backfill from wholesale turnaround values.
ALTER TABLE "WooProduct" ADD COLUMN "productionMinDays" INTEGER, ADD COLUMN "productionMaxDays" INTEGER;
ALTER TABLE "ProductVariation" ADD COLUMN "productionMinDays" INTEGER, ADD COLUMN "productionMaxDays" INTEGER;
ALTER TABLE "WooProduct" ADD CONSTRAINT "WooProduct_production_range_check" CHECK (
  ("productionMinDays" IS NULL AND "productionMaxDays" IS NULL) OR
  ("productionMinDays" IS NOT NULL AND "productionMaxDays" IS NOT NULL AND
   "productionMinDays" BETWEEN 0 AND 3650 AND "productionMaxDays" BETWEEN "productionMinDays" AND 3650)
);
ALTER TABLE "ProductVariation" ADD CONSTRAINT "ProductVariation_production_range_check" CHECK (
  ("productionMinDays" IS NULL AND "productionMaxDays" IS NULL) OR
  ("productionMinDays" IS NOT NULL AND "productionMaxDays" IS NOT NULL AND
   "productionMinDays" BETWEEN 0 AND 3650 AND "productionMaxDays" BETWEEN "productionMinDays" AND 3650)
);
CREATE TABLE "DeliveryEstimateSettings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "settings" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryEstimateSettings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DeliveryEstimateSettings_accountId_key" ON "DeliveryEstimateSettings"("accountId");
