-- Additive compatibility repair for installations originally provisioned with
-- `prisma db push` and fresh installations built only from migration history.

ALTER TABLE "WooOrder"
    ADD COLUMN IF NOT EXISTS "billingEmail" TEXT,
    ADD COLUMN IF NOT EXISTS "billingCountry" TEXT,
    ADD COLUMN IF NOT EXISTS "wooCustomerId" INTEGER;

ALTER TABLE "WooProduct"
    ADD COLUMN IF NOT EXISTS "miscCosts" JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS "goldPriceType" TEXT,
    ADD COLUMN IF NOT EXISTS "stockQuantity" INTEGER,
    ADD COLUMN IF NOT EXISTS "manageStock" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "WooReview"
    ADD COLUMN IF NOT EXISTS "matchStatus" TEXT;

CREATE TABLE IF NOT EXISTS "ProductVariation" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "wooId" INTEGER NOT NULL,
    "sku" TEXT,
    "price" DECIMAL(10,2),
    "salePrice" DECIMAL(10,2),
    "stockStatus" TEXT,
    "stockQuantity" INTEGER,
    "manageStock" BOOLEAN NOT NULL DEFAULT false,
    "weight" DECIMAL(10,4),
    "length" DECIMAL(10,2),
    "width" DECIMAL(10,2),
    "height" DECIMAL(10,2),
    "cogs" DECIMAL(10,2),
    "miscCosts" JSONB DEFAULT '[]'::jsonb,
    "binLocation" TEXT,
    "isGoldPriceApplied" BOOLEAN NOT NULL DEFAULT false,
    "goldPriceType" TEXT,
    "images" JSONB DEFAULT '[]'::jsonb,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductVariation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProductVariation"
    ADD COLUMN IF NOT EXISTS "sku" TEXT,
    ADD COLUMN IF NOT EXISTS "price" DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS "salePrice" DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS "stockStatus" TEXT,
    ADD COLUMN IF NOT EXISTS "stockQuantity" INTEGER,
    ADD COLUMN IF NOT EXISTS "manageStock" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "weight" DECIMAL(10,4),
    ADD COLUMN IF NOT EXISTS "length" DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS "width" DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS "height" DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS "cogs" DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS "miscCosts" JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS "binLocation" TEXT,
    ADD COLUMN IF NOT EXISTS "isGoldPriceApplied" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "goldPriceType" TEXT,
    ADD COLUMN IF NOT EXISTS "images" JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS "rawData" JSONB,
    ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ProductVariation" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS "ProductVariation_productId_wooId_key"
    ON "ProductVariation"("productId", "wooId");
CREATE INDEX IF NOT EXISTS "ProductVariation_productId_stockStatus_idx"
    ON "ProductVariation"("productId", "stockStatus");
CREATE INDEX IF NOT EXISTS "ProductVariation_productId_updatedAt_idx"
    ON "ProductVariation"("productId", "updatedAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ProductVariation_productId_fkey'
    ) THEN
        ALTER TABLE "ProductVariation"
            ADD CONSTRAINT "ProductVariation_productId_fkey"
            FOREIGN KEY ("productId") REFERENCES "WooProduct"("id")
            ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "WooPage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "wooId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT,
    "status" TEXT,
    "permalink" TEXT,
    "content" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "seoScore" INTEGER DEFAULT 0,
    "seoData" JSONB DEFAULT '{}'::jsonb,
    "dateCreated" TIMESTAMP(3) NOT NULL,
    "dateModified" TIMESTAMP(3) NOT NULL,
    "rawData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WooPage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WooPage"
    ADD COLUMN IF NOT EXISTS "slug" TEXT,
    ADD COLUMN IF NOT EXISTS "status" TEXT,
    ADD COLUMN IF NOT EXISTS "permalink" TEXT,
    ADD COLUMN IF NOT EXISTS "seoScore" INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "seoData" JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "WooPage" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS "WooPage_accountId_wooId_key"
    ON "WooPage"("accountId", "wooId");
CREATE INDEX IF NOT EXISTS "WooPage_accountId_status_idx"
    ON "WooPage"("accountId", "status");
CREATE INDEX IF NOT EXISTS "WooPage_accountId_dateModified_idx"
    ON "WooPage"("accountId", "dateModified" DESC);
CREATE INDEX IF NOT EXISTS "WooPage_accountId_updatedAt_idx"
    ON "WooPage"("accountId", "updatedAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'WooPage_accountId_fkey'
    ) THEN
        ALTER TABLE "WooPage"
            ADD CONSTRAINT "WooPage_accountId_fkey"
            FOREIGN KEY ("accountId") REFERENCES "Account"("id")
            ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "WooBlogPost" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "wooId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT,
    "status" TEXT,
    "permalink" TEXT,
    "content" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "seoScore" INTEGER DEFAULT 0,
    "seoData" JSONB DEFAULT '{}'::jsonb,
    "dateCreated" TIMESTAMP(3) NOT NULL,
    "dateModified" TIMESTAMP(3) NOT NULL,
    "rawData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WooBlogPost_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WooBlogPost"
    ADD COLUMN IF NOT EXISTS "slug" TEXT,
    ADD COLUMN IF NOT EXISTS "status" TEXT,
    ADD COLUMN IF NOT EXISTS "permalink" TEXT,
    ADD COLUMN IF NOT EXISTS "seoScore" INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "seoData" JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "WooBlogPost" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS "WooBlogPost_accountId_wooId_key"
    ON "WooBlogPost"("accountId", "wooId");
CREATE INDEX IF NOT EXISTS "WooBlogPost_accountId_status_idx"
    ON "WooBlogPost"("accountId", "status");
CREATE INDEX IF NOT EXISTS "WooBlogPost_accountId_dateModified_idx"
    ON "WooBlogPost"("accountId", "dateModified" DESC);
CREATE INDEX IF NOT EXISTS "WooBlogPost_accountId_updatedAt_idx"
    ON "WooBlogPost"("accountId", "updatedAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'WooBlogPost_accountId_fkey'
    ) THEN
        ALTER TABLE "WooBlogPost"
            ADD CONSTRAINT "WooBlogPost_accountId_fkey"
            FOREIGN KEY ("accountId") REFERENCES "Account"("id")
            ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
    END IF;
END $$;

-- Reconciliation queries use account/product plus updatedAt on every full sync.
CREATE INDEX IF NOT EXISTS "WooOrder_accountId_updatedAt_idx"
    ON "WooOrder"("accountId", "updatedAt");
CREATE INDEX IF NOT EXISTS "WooOrder_accountId_status_dateCreated_idx"
    ON "WooOrder"("accountId", "status", "dateCreated" DESC);
CREATE INDEX IF NOT EXISTS "WooOrder_accountId_billingEmail_idx"
    ON "WooOrder"("accountId", "billingEmail");
CREATE INDEX IF NOT EXISTS "WooOrder_accountId_wooCustomerId_idx"
    ON "WooOrder"("accountId", "wooCustomerId");
CREATE INDEX IF NOT EXISTS "WooCustomer_accountId_updatedAt_idx"
    ON "WooCustomer"("accountId", "updatedAt");
CREATE INDEX IF NOT EXISTS "WooReview_accountId_updatedAt_idx"
    ON "WooReview"("accountId", "updatedAt");
CREATE INDEX IF NOT EXISTS "WooReview_accountId_status_idx"
    ON "WooReview"("accountId", "status");
CREATE INDEX IF NOT EXISTS "WooReview_accountId_rating_idx"
    ON "WooReview"("accountId", "rating");
CREATE INDEX IF NOT EXISTS "WooReview_accountId_dateCreated_idx"
    ON "WooReview"("accountId", "dateCreated" DESC);
CREATE INDEX IF NOT EXISTS "WooProduct_accountId_updatedAt_idx"
    ON "WooProduct"("accountId", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "SyncLog_accountId_entityType_status_idx"
    ON "SyncLog"("accountId", "entityType", "status");
