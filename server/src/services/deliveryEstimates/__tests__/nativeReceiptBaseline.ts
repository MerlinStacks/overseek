/** Historical source columns used by the real receipt and BOM services. This only
 * extends the synthetic source baseline; no delivery migration DDL is replaced.
 */
export async function extendNativeReceiptBaseline(db: any) {
    await db.exec(`
        ALTER TABLE "WooProduct"
            ADD COLUMN name text DEFAULT 'Fixture product', ADD COLUMN sku text, ADD COLUMN status text DEFAULT 'publish',
            ADD COLUMN "catalogVisibility" text DEFAULT 'visible', ADD COLUMN "dateCreated" timestamp DEFAULT now(),
            ADD COLUMN price numeric DEFAULT 0, ADD COLUMN "stockStatus" text DEFAULT 'instock',
            ADD COLUMN permalink text, ADD COLUMN "mainImage" text, ADD COLUMN images jsonb DEFAULT '[]',
            ADD COLUMN "isGoldPriceApplied" boolean DEFAULT false, ADD COLUMN "goldPriceType" text,
            ADD COLUMN weight numeric, ADD COLUMN length numeric, ADD COLUMN width numeric, ADD COLUMN height numeric,
            ADD COLUMN cogs numeric, ADD COLUMN "miscCosts" jsonb, ADD COLUMN "seoScore" int, ADD COLUMN "seoData" jsonb,
            ADD COLUMN "merchantCenterScore" int, ADD COLUMN "merchantCenterIssues" jsonb, ADD COLUMN "binLocation" text,
            ADD COLUMN "baseTurnaroundDays" int, ADD COLUMN "stockQuantity" int DEFAULT 10,
            ADD COLUMN "createdAt" timestamp DEFAULT now(), ADD COLUMN "updatedAt" timestamp DEFAULT now(),
            ADD UNIQUE ("accountId","wooId");
        ALTER TABLE "ProductVariation"
            ADD COLUMN sku text, ADD COLUMN price numeric DEFAULT 0, ADD COLUMN "salePrice" numeric,
            ADD COLUMN "stockStatus" text DEFAULT 'instock', ADD COLUMN "stockQuantity" int DEFAULT 10,
            ADD COLUMN weight numeric, ADD COLUMN length numeric, ADD COLUMN width numeric, ADD COLUMN height numeric,
            ADD COLUMN cogs numeric, ADD COLUMN "miscCosts" jsonb, ADD COLUMN "binLocation" text,
            ADD COLUMN "isGoldPriceApplied" boolean DEFAULT false, ADD COLUMN "goldPriceType" text, ADD COLUMN images jsonb,
            ADD COLUMN "createdAt" timestamp DEFAULT now(), ADD COLUMN "updatedAt" timestamp DEFAULT now(),
            ADD UNIQUE ("productId","wooId");
        ALTER TABLE "PurchaseOrder"
            ADD COLUMN "supplierId" text DEFAULT 'supplier', ADD COLUMN "orderNumber" text DEFAULT 'fixture',
            ADD COLUMN "orderDate" timestamp DEFAULT now(), ADD COLUMN "totalAmount" numeric DEFAULT 0,
            ADD COLUMN notes text, ADD COLUMN "trackingNumber" text, ADD COLUMN "trackingLink" text,
            ADD COLUMN "createdAt" timestamp DEFAULT now(), ADD COLUMN "updatedAt" timestamp DEFAULT now();
        ALTER TABLE "BOM" ADD COLUMN "createdAt" timestamp DEFAULT now(), ADD COLUMN "updatedAt" timestamp DEFAULT now(),
            ADD UNIQUE ("productId","variationId");
        CREATE TABLE "AuditLog" (id text PRIMARY KEY, "accountId" text, "userId" text, action text, resource text,
            "resourceId" text, details jsonb, source text, "previousValue" jsonb, "validationStatus" text, "createdAt" timestamp DEFAULT now());
        CREATE TABLE "InternalProduct" (id text PRIMARY KEY, "accountId" text, name text, "stockQuantity" int DEFAULT 0);
    `);
}
