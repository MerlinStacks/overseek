-- AlterTable
ALTER TABLE "WooProduct"
ADD COLUMN "status" TEXT,
ADD COLUMN "catalogVisibility" TEXT,
ADD COLUMN "dateCreated" TIMESTAMP(3);

-- Backfill publication metadata already retained from WooCommerce.
UPDATE "WooProduct"
SET "status" = NULLIF("rawData"->>'status', ''),
    "catalogVisibility" = COALESCE(NULLIF("rawData"->>'catalog_visibility', ''), 'visible'),
    "dateCreated" = COALESCE(
        CASE WHEN "rawData"->>'date_created_gmt' ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}'
            THEN ("rawData"->>'date_created_gmt')::timestamp END,
        CASE WHEN "rawData"->>'date_created' ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}'
            THEN ("rawData"->>'date_created')::timestamp END
    );

-- CreateIndex
CREATE INDEX "WooProduct_accountId_status_catalogVisibility_dateCreated_idx"
ON "WooProduct"("accountId", "status", "catalogVisibility", "dateCreated" DESC);
