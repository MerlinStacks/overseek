-- DropForeignKey
ALTER TABLE "BOMItem" DROP CONSTRAINT "BOMItem_supplierItemId_fkey";

-- DropIndex
DROP INDEX "BOMItem_bomId_supplierItemId_key";

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "webhookSecret" TEXT;

-- AlterTable
ALTER TABLE "BOMItem" ADD COLUMN     "childProductId" TEXT,
ALTER COLUMN "supplierItemId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "BOMItem" ADD CONSTRAINT "BOMItem_supplierItemId_fkey" FOREIGN KEY ("supplierItemId") REFERENCES "SupplierItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOMItem" ADD CONSTRAINT "BOMItem_childProductId_fkey" FOREIGN KEY ("childProductId") REFERENCES "WooProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
