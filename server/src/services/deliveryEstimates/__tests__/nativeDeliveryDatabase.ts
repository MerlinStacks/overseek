import { readFile, readdir } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { openFreshnessTestDatabase } from './freshnessDatabase';

/** Two independent native connections; every table lives in the helper's random schema.
 * Only the historical source baseline is synthetic. All delivery migrations
 * and all Prisma worker/finalization queries execute unchanged.
 */
export async function openNativeDeliveryDatabase(beforeMigration?: (db: any, migration: string) => Promise<void>) {
    const connectionString = process.env.DELIVERY_FRESHNESS_TEST_DATABASE_URL;
    if (!connectionString) throw new Error('Explicit native test URL required');
    const db = await openFreshnessTestDatabase();
    let client: PrismaClient | undefined;
    try {
        const schema = (await db.query('SELECT current_schema() AS schema')).rows[0].schema;
        if (!/^freshness_test_[a-f0-9]+$/.test(schema)) throw new Error('Not an isolated test schema');
        await db.exec(`
            CREATE TABLE "Account" (id text PRIMARY KEY, timezone text DEFAULT 'UTC',
                name text DEFAULT 'Test', domain text, "sitemapUrl" text,
                "wooUrl" text DEFAULT '', "wooConsumerKey" text DEFAULT '', "wooConsumerSecret" text DEFAULT '', "webhookSecret" text,
                "wooNeedsReconnect" boolean DEFAULT false, currency text DEFAULT 'USD', "weightUnit" text DEFAULT 'kg', "dimensionUnit" text DEFAULT 'cm',
                "revenueTaxInclusive" boolean DEFAULT true, "autoSendInvoiceOnNewOrder" boolean DEFAULT false, "invoiceRecipientEmail" text,
                "subscribeNewCustomersByDefault" boolean DEFAULT true, "reviewShowCountryFlags" boolean DEFAULT false, "reviewerNameDisplay" text DEFAULT 'full',
                "reviewShowTransparencyBadge" boolean DEFAULT true, "reviewShowVerifiedCountBadge" boolean DEFAULT true,
                "reviewModerationMode" text DEFAULT 'auto_publish', "reviewModerationThreshold" int DEFAULT 4,
                "goldPrice" numeric, "goldPriceCurrency" text, "goldPrice18ct" numeric, "goldPrice9ct" numeric, "goldPrice18ctWhite" numeric,
                "goldPrice9ctWhite" numeric, "goldPriceMargin" numeric, "goldPriceUpdatedAt" timestamp,
                "openRouterApiKey" text, "aiModel" text, "embeddingModel" text, appearance jsonb, "orderTagMappings" jsonb, "excludedIps" jsonb,
                "crawlerBlockPageHtml" text, "defaultSearchConsoleSiteUrl" text, "createdAt" timestamp DEFAULT now(), "updatedAt" timestamp DEFAULT now());
            CREATE TABLE "WooOrder" (id text PRIMARY KEY);
            CREATE TABLE "WooProduct" (id text PRIMARY KEY, "accountId" text, "wooId" int, "supplierId" text, "manageStock" boolean, "rawData" jsonb);
            CREATE TABLE "ProductVariation" (id text PRIMARY KEY, "productId" text, "wooId" int, "manageStock" boolean, "rawData" jsonb);
            CREATE TABLE "AccountFeature" (id text PRIMARY KEY, "accountId" text, "featureKey" text, "isEnabled" boolean, config jsonb DEFAULT '{}', "createdAt" timestamp DEFAULT now(), "updatedAt" timestamp DEFAULT now(), UNIQUE ("accountId", "featureKey"));
            CREATE TABLE "BOM" (id text PRIMARY KEY, "productId" text, "variationId" int DEFAULT 0);
            CREATE TABLE "BOMItem" (id text PRIMARY KEY, "bomId" text, "isActive" boolean, quantity numeric, "wasteFactor" numeric DEFAULT 0,
                "childProductId" text, "childVariationId" int, "internalProductId" text, "supplierItemId" text, "deactivatedReason" text);
            CREATE TABLE "Supplier" (id text PRIMARY KEY, "accountId" text, "leadTimeMin" int, "leadTimeMax" int, "leadTimeDefault" int);
            CREATE TABLE "PurchaseOrder" (id text PRIMARY KEY, "accountId" text, status text, "expectedDate" timestamp);
            CREATE TABLE "PurchaseOrderItem" (id text PRIMARY KEY, "purchaseOrderId" text, "productId" text, "variationWooId" int, quantity int);
            CREATE TABLE "BOMDeductionLedger" (id text PRIMARY KEY, "accountId" text, "orderId" int, "componentType" text, "componentId" text, "componentName" text,
                "wooId" int,"parentWooId" int,"quantityDeducted" double precision,"previousStock" double precision,"newStock" double precision,status text DEFAULT 'EXECUTED',"createdAt" timestamp DEFAULT now(),"rolledBackAt" timestamp);
            INSERT INTO "Account" (id) VALUES ('a'), ('other');
        `);
        const migrations = (await readdir('prisma/migrations')).filter(name => /^2026092[123]/.test(name)).sort();
        if (migrations.length !== 18) throw new Error(`Review delivery migration chain: expected 18 files, found ${migrations.length}`);
        for (const migration of migrations) {
            await beforeMigration?.(db, migration);
            await db.exec(await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
        }
        client = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1,
            options: `-c search_path=${schema} -c statement_timeout=10000`,
        }, { schema }) });
        await client.$connect();
        return { db, client, migrations, close: async () => { try { await client!.$disconnect(); } finally { await db.close(); } } };
    } catch (error) {
        await client?.$disconnect();
        await db.close();
        throw error;
    }
}
