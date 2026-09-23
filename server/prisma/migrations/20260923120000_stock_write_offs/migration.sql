CREATE TABLE "StockWriteOff" (
  "id" TEXT PRIMARY KEY, "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE,
  "reference" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','FINALIZED')),
  "reason" TEXT NOT NULL CHECK ("reason" IN ('MISSING','DAMAGED','ENTRY_ERROR','EXPIRED','OTHER')),
  "notes" TEXT, "createdBy" TEXT NOT NULL, "finalizedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "finalizedAt" TIMESTAMP(3), "totalCost" DECIMAL(24,4) NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "StockWriteOff_accountId_reference_key" ON "StockWriteOff"("accountId","reference");
CREATE INDEX "StockWriteOff_accountId_status_finalizedAt_idx" ON "StockWriteOff"("accountId","status","finalizedAt");
CREATE TABLE "StockWriteOffItem" (
  "id" TEXT PRIMARY KEY, "writeOffId" TEXT NOT NULL REFERENCES "StockWriteOff"("id") ON DELETE CASCADE,
  "productId" TEXT, "variationId" INTEGER, "internalProductId" TEXT,
  "name" TEXT NOT NULL, "sku" TEXT, "type" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" BETWEEN 1 AND 1000000),
  "unitCostOverride" DECIMAL(16,4), "unitCost" DECIMAL(16,4) NOT NULL, "totalCost" DECIMAL(24,4) NOT NULL,
  "stockBefore" INTEGER, "stockAfter" INTEGER, "operationId" TEXT,
  "cascadeState" TEXT NOT NULL DEFAULT 'none', "cascadeAttempts" INTEGER NOT NULL DEFAULT 0,
  "cascadeNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "cascadeError" TEXT,
  CHECK (("productId" IS NOT NULL AND "internalProductId" IS NULL) OR
    ("productId" IS NULL AND "variationId" IS NULL AND "internalProductId" IS NOT NULL)),
  CHECK ("unitCost" >= 0 AND "totalCost" >= 0 AND ("unitCostOverride" IS NULL OR "unitCostOverride" >= 0))
);
CREATE INDEX "StockWriteOffItem_writeOffId_idx" ON "StockWriteOffItem"("writeOffId");
CREATE INDEX "StockWriteOffItem_cascadeState_cascadeNextAttemptAt_idx" ON "StockWriteOffItem"("cascadeState","cascadeNextAttemptAt");
