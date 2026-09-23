-- Additive launch freshness: source changes and their dirty identity commit together.
ALTER TABLE "DeliveryInputSync" ADD COLUMN "inboundRenewAt" TIMESTAMP(3);
CREATE INDEX "DeliveryInputSync_inbound_renew_idx" ON "DeliveryInputSync"("scope", "status", "inboundRenewAt", "id");
UPDATE "DeliveryInputSync" SET "inboundRenewAt" = ("payload"->>'expiresAt')::timestamptz - interval '4 hours'
WHERE "scope" = 'inbound' AND "payload"->>'expiresAt' IS NOT NULL
  AND jsonb_array_length(COALESCE("payload"->'targets', '[]'::jsonb)) > 0;

CREATE FUNCTION delivery_dirty_parent(parent_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p record;
BEGIN
  SELECT id, "accountId", "wooId", "productionMinDays", "productionMaxDays" INTO p FROM "WooProduct" WHERE id = parent_id;
  IF NOT FOUND THEN RETURN; END IF;
  -- An Account cascade is teardown, not a storefront mutation to publish.
  IF NOT EXISTS (SELECT 1 FROM "Account" WHERE id = p."accountId") THEN RETURN; END IF;
  IF p."productionMinDays" IS NULL AND p."productionMaxDays" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "ProductVariation" v WHERE v."productId" = parent_id
      AND (v."productionMinDays" IS NOT NULL OR v."productionMaxDays" IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM "DeliveryInputSync" s WHERE s."accountId" = p."accountId"
      AND s."entityId" = p."wooId" AND s.scope IN ('product', 'inbound')) THEN RETURN; END IF;
  INSERT INTO "DeliveryInboundDirtyTarget" ("accountId", "wooId", "version", "createdAt", "updatedAt")
    VALUES (p."accountId", p."wooId", 1, now(), now())
    ON CONFLICT ("accountId", "wooId") DO UPDATE SET "version" = "DeliveryInboundDirtyTarget"."version" + 1, "updatedAt" = now();
END $$;

CREATE FUNCTION delivery_product_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD."accountId", OLD."wooId", OLD."manageStock", OLD."supplierId", OLD."productionMinDays", OLD."productionMaxDays",
      OLD."rawData"->>'type', OLD."rawData"->>'manage_stock', OLD."rawData"->>'backorders')
    IS NOT DISTINCT FROM (NEW."accountId", NEW."wooId", NEW."manageStock", NEW."supplierId", NEW."productionMinDays", NEW."productionMaxDays",
      NEW."rawData"->>'type', NEW."rawData"->>'manage_stock', NEW."rawData"->>'backorders') THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN PERFORM delivery_dirty_parent(OLD.id); RETURN OLD; END IF;
  PERFORM delivery_dirty_parent(NEW.id); RETURN NEW;
END $$;
CREATE TRIGGER delivery_product_write AFTER INSERT OR UPDATE ON "WooProduct" FOR EACH ROW EXECUTE FUNCTION delivery_product_changed();
CREATE TRIGGER delivery_product_identity BEFORE UPDATE ON "WooProduct" FOR EACH ROW
  WHEN (OLD."accountId" IS DISTINCT FROM NEW."accountId" OR OLD."wooId" IS DISTINCT FROM NEW."wooId") EXECUTE FUNCTION delivery_product_changed();
CREATE TRIGGER delivery_product_delete BEFORE DELETE ON "WooProduct" FOR EACH ROW EXECUTE FUNCTION delivery_product_changed();

CREATE FUNCTION delivery_variation_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD."productId", OLD."wooId", OLD."manageStock", OLD."productionMinDays", OLD."productionMaxDays",
      OLD."rawData"->>'manage_stock', OLD."rawData"->>'backorders')
    IS NOT DISTINCT FROM (NEW."productId", NEW."wooId", NEW."manageStock", NEW."productionMinDays", NEW."productionMaxDays",
      NEW."rawData"->>'manage_stock', NEW."rawData"->>'backorders') THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM delivery_dirty_parent(OLD."productId"); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM delivery_dirty_parent(NEW."productId"); RETURN NEW; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER delivery_variation_write AFTER INSERT OR UPDATE ON "ProductVariation" FOR EACH ROW EXECUTE FUNCTION delivery_variation_changed();
CREATE TRIGGER delivery_variation_delete BEFORE DELETE ON "ProductVariation" FOR EACH ROW EXECUTE FUNCTION delivery_variation_changed();

CREATE FUNCTION delivery_bom_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM delivery_dirty_parent(OLD."productId"); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM delivery_dirty_parent(NEW."productId"); RETURN NEW; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER delivery_bom_write AFTER INSERT OR UPDATE OR DELETE ON "BOM" FOR EACH ROW EXECUTE FUNCTION delivery_bom_changed();

CREATE FUNCTION delivery_bom_item_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM delivery_dirty_parent("productId") FROM "BOM" WHERE id = OLD."bomId"; END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM delivery_dirty_parent("productId") FROM "BOM" WHERE id = NEW."bomId";
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER delivery_bom_item_write AFTER INSERT OR UPDATE OR DELETE ON "BOMItem" FOR EACH ROW EXECUTE FUNCTION delivery_bom_item_changed();

CREATE FUNCTION delivery_supplier_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD."leadTimeMin", OLD."leadTimeMax", OLD."leadTimeDefault")
    IS NOT DISTINCT FROM (NEW."leadTimeMin", NEW."leadTimeMax", NEW."leadTimeDefault") THEN RETURN NEW; END IF;
  PERFORM delivery_dirty_parent(id) FROM "WooProduct" WHERE "supplierId" = OLD.id AND "accountId" = OLD."accountId";
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_supplier_write AFTER UPDATE ON "Supplier" FOR EACH ROW EXECUTE FUNCTION delivery_supplier_changed();
CREATE TRIGGER delivery_supplier_delete BEFORE DELETE ON "Supplier" FOR EACH ROW EXECUTE FUNCTION delivery_supplier_changed();

-- Includes maintenance/direct writers as well as the Account-locked PO service.
CREATE FUNCTION delivery_po_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.status, OLD."expectedDate") IS NOT DISTINCT FROM (NEW.status, NEW."expectedDate") THEN RETURN NEW; END IF;
  PERFORM delivery_dirty_parent("productId") FROM "PurchaseOrderItem" WHERE "purchaseOrderId" = OLD.id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_po_write AFTER UPDATE ON "PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION delivery_po_changed();
CREATE TRIGGER delivery_po_delete BEFORE DELETE ON "PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION delivery_po_changed();

CREATE FUNCTION delivery_po_item_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD."productId", OLD."variationWooId", OLD.quantity, OLD."purchaseOrderId")
    IS NOT DISTINCT FROM (NEW."productId", NEW."variationWooId", NEW.quantity, NEW."purchaseOrderId") THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM delivery_dirty_parent(OLD."productId"); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM delivery_dirty_parent(NEW."productId"); RETURN NEW; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER delivery_po_item_write AFTER INSERT OR UPDATE OR DELETE ON "PurchaseOrderItem" FOR EACH ROW EXECUTE FUNCTION delivery_po_item_changed();

-- Park deadlines once per account decision, rather than revisiting each unsupported
-- product on every timer tick. Re-enable/support restores the ORIGINAL deadline;
-- only the asynchronous builder can create a new generation.
CREATE FUNCTION delivery_renewal_allowed(account_id text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM "DeliverySyncAccount" WHERE "accountId" = account_id
      AND "capabilityStatus" = 'supported' AND "inboundCapabilityStatus" = 'supported' AND NOT "inboundFailed")
    AND NOT EXISTS (SELECT 1 FROM "AccountFeature" WHERE "accountId" = account_id
      AND "featureKey" = 'DELIVERY_ESTIMATES' AND NOT "isEnabled")
$$;
CREATE FUNCTION delivery_reset_renewals(account_id text) RETURNS void LANGUAGE sql AS $$
  UPDATE "DeliveryInputSync" SET "inboundRenewAt" = CASE WHEN delivery_renewal_allowed(account_id)
      AND jsonb_array_length(COALESCE(payload->'targets', '[]'::jsonb)) > 0
    THEN (payload->>'expiresAt')::timestamptz - interval '4 hours' ELSE NULL END
  WHERE "accountId" = account_id AND scope = 'inbound'
$$;
CREATE FUNCTION delivery_renewal_capability_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (OLD."capabilityStatus", OLD."inboundCapabilityStatus", OLD."inboundFailed")
      IS DISTINCT FROM (NEW."capabilityStatus", NEW."inboundCapabilityStatus", NEW."inboundFailed") THEN
    PERFORM delivery_reset_renewals(NEW."accountId");
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_renewal_capability AFTER INSERT OR UPDATE ON "DeliverySyncAccount" FOR EACH ROW EXECUTE FUNCTION delivery_renewal_capability_changed();
CREATE FUNCTION delivery_renewal_feature_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."featureKey" = 'DELIVERY_ESTIMATES' THEN PERFORM delivery_reset_renewals(OLD."accountId"); END IF;
    RETURN OLD;
  END IF;
  IF NEW."featureKey" = 'DELIVERY_ESTIMATES' THEN PERFORM delivery_reset_renewals(NEW."accountId"); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_renewal_feature AFTER INSERT OR UPDATE OR DELETE ON "AccountFeature" FOR EACH ROW EXECUTE FUNCTION delivery_renewal_feature_changed();
CREATE FUNCTION delivery_renewal_payload_written() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scope = 'inbound' AND NOT delivery_renewal_allowed(NEW."accountId") THEN NEW."inboundRenewAt" = NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_renewal_payload BEFORE INSERT OR UPDATE OF payload ON "DeliveryInputSync" FOR EACH ROW EXECUTE FUNCTION delivery_renewal_payload_written();
UPDATE "DeliveryInputSync" SET "inboundRenewAt" = NULL WHERE scope = 'inbound' AND NOT delivery_renewal_allowed("accountId");
