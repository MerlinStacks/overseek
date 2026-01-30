-- Fix order dateCreated timezone offset
-- Orders were synced using date_created (store local time) instead of date_created_gmt (UTC)
-- This migration updates all orders to use the correct UTC timestamp from rawData

UPDATE "WooOrder"
SET "dateCreated" = ("rawData"->>'date_created_gmt')::timestamp
WHERE "rawData"->>'date_created_gmt' IS NOT NULL
  AND "dateCreated" != ("rawData"->>'date_created_gmt')::timestamp;

-- Also fix reviews that have the same issue
UPDATE "WooReview"
SET "dateCreated" = ("rawData"->>'date_created_gmt')::timestamp
WHERE "rawData"->>'date_created_gmt' IS NOT NULL
  AND "dateCreated" != ("rawData"->>'date_created_gmt')::timestamp;
