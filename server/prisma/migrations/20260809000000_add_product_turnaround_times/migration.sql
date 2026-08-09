ALTER TABLE "WooProduct"
ADD COLUMN "baseTurnaroundDays" INTEGER;

ALTER TABLE "WholesalePriceTier"
ADD COLUMN "leadTimeDays" INTEGER;

ALTER TABLE "WooProduct"
ADD CONSTRAINT "WooProduct_baseTurnaroundDays_check"
CHECK ("baseTurnaroundDays" IS NULL OR "baseTurnaroundDays" BETWEEN 0 AND 3650);

ALTER TABLE "WholesalePriceTier"
ADD CONSTRAINT "WholesalePriceTier_leadTimeDays_check"
CHECK ("leadTimeDays" IS NULL OR "leadTimeDays" BETWEEN 0 AND 3650);
