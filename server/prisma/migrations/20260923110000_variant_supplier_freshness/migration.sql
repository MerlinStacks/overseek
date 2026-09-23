-- Preserve existing trigger bindings and freshness attestations while extending
-- transactional invalidation to variant supplier overrides (NULL inherits).
CREATE OR REPLACE FUNCTION delivery_variation_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD."productId", OLD."wooId", OLD."manageStock", OLD."supplierId", OLD."productionMinDays", OLD."productionMaxDays",
      OLD."rawData"->>'manage_stock', OLD."rawData"->>'backorders')
    IS NOT DISTINCT FROM (NEW."productId", NEW."wooId", NEW."manageStock", NEW."supplierId", NEW."productionMinDays", NEW."productionMaxDays",
      NEW."rawData"->>'manage_stock', NEW."rawData"->>'backorders') THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM delivery_dirty_parent(OLD."productId"); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM delivery_dirty_parent(NEW."productId"); RETURN NEW; END IF;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION delivery_supplier_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD."leadTimeMin", OLD."leadTimeMax", OLD."leadTimeDefault")
    IS NOT DISTINCT FROM (NEW."leadTimeMin", NEW."leadTimeMax", NEW."leadTimeDefault") THEN RETURN NEW; END IF;
  -- EXISTS avoids multiplying dirty versions for siblings sharing an override.
  -- The existing BEFORE DELETE binding captures assignments before SET NULL.
  PERFORM delivery_dirty_parent(p.id) FROM "WooProduct" p
    WHERE p."accountId" = OLD."accountId" AND (p."supplierId" = OLD.id
      OR EXISTS (SELECT 1 FROM "ProductVariation" v WHERE v."productId" = p.id AND v."supplierId" = OLD.id));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
