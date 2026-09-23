ALTER TABLE "ProductVariation" ADD COLUMN "supplierId" TEXT;

CREATE INDEX "ProductVariation_supplierId_idx" ON "ProductVariation"("supplierId");

ALTER TABLE "ProductVariation" ADD CONSTRAINT "ProductVariation_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
