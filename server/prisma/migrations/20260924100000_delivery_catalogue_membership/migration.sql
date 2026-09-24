-- Narrow delivery membership, independent of retained inventory/history rows.
-- Legacy rows stay eligible until a complete, validated sync confirms absence.
ALTER TABLE "WooProduct" ADD COLUMN "deliveryMembershipObservedAt" TIMESTAMP(3);
ALTER TABLE "ProductVariation" ADD COLUMN "deliveryActive" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "ProductVariation_productId_deliveryActive_wooId_idx" ON "ProductVariation"("productId", "deliveryActive", "wooId");

-- Preserve every prior invalidation (including supplier overrides), trigger
-- bindings and BEFORE DELETE behavior. Metadata-only/no-op writes do not dirty.
CREATE OR REPLACE FUNCTION delivery_variation_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD."productId", OLD."wooId", OLD."manageStock", OLD."supplierId", OLD."productionMinDays", OLD."productionMaxDays",
      OLD."rawData"->>'manage_stock', OLD."rawData"->>'backorders', OLD."deliveryActive")
    IS NOT DISTINCT FROM (NEW."productId", NEW."wooId", NEW."manageStock", NEW."supplierId", NEW."productionMinDays", NEW."productionMaxDays",
      NEW."rawData"->>'manage_stock', NEW."rawData"->>'backorders', NEW."deliveryActive") THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM delivery_dirty_parent(OLD."productId"); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM delivery_dirty_parent(NEW."productId"); RETURN NEW; END IF;
  RETURN OLD;
END $$;
COMMENT ON FUNCTION delivery_variation_changed() IS 'overseek-delivery-membership-v3';
