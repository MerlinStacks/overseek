-- AlterTable
ALTER TABLE "WooProduct" 
ADD COLUMN IF NOT EXISTS "cogs" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "supplierId" TEXT,
ADD COLUMN IF NOT EXISTS "binLocation" TEXT,
ADD COLUMN IF NOT EXISTS "seoScore" INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS "seoData" JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS "merchantCenterScore" INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS "merchantCenterIssues" JSONB DEFAULT '[]';

-- AddForeignKey (Safe version: check if FK constraint exists is hard in raw SQL cross-db, 
-- but ensuring column exists is step 1. Prisma doesn't always add FK constraints in manual fixes easily without naming knowledge.
-- For now, we mainly need the columns to prevent runtime crashes on SELECT. 
-- Adding FK constraint if Supplier table exists is good practice but might fail if Supplier table is missing.
-- Given previous logs, we haven't seen Supplier errors yet. Let's start with columns.)
