-- Existing vectors deliberately have unknown provenance until explicitly regenerated.
ALTER TABLE "WooProduct" ADD COLUMN "embeddingSourceVersion" TIMESTAMP(3),
 ADD COLUMN "embeddingModelId" TEXT, ADD COLUMN "embeddingDimensions" INTEGER;
