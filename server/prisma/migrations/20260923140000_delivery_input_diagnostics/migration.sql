-- Additive only: historical generic failures intentionally retain NULL diagnostics.
ALTER TABLE "DeliveryInputSync" ADD COLUMN "lastDiagnostic" JSONB;
ALTER TABLE "DeliverySyncAccount" ADD COLUMN "lastDiagnostic" JSONB;
ALTER TABLE "DeliverySyncAccount" ADD COLUMN "capabilityDetails" JSONB;
CREATE INDEX "DeliveryInputSync_attention_idx" ON "DeliveryInputSync"("accountId", "status", "id");
