-- Preserve all source-field invalidations, including future inventory/link fields.
-- Only the bookkeeping timestamp is excluded from the null-safe row comparison.
CREATE OR REPLACE FUNCTION delivery_bom_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - 'updatedAt') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'updatedAt') THEN
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM delivery_dirty_parent(OLD."productId"); END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM delivery_dirty_parent(NEW."productId");
  ELSIF TG_OP = 'UPDATE' AND NEW."productId" IS DISTINCT FROM OLD."productId" THEN
    PERFORM delivery_dirty_parent(NEW."productId");
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION delivery_bom_item_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_parent text; new_parent text;
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - 'updatedAt') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'updatedAt') THEN
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    SELECT "productId" INTO old_parent FROM "BOM" WHERE id = OLD."bomId";
    PERFORM delivery_dirty_parent(old_parent);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT "productId" INTO new_parent FROM "BOM" WHERE id = NEW."bomId";
    -- Different recipes can still belong to the same parent.
    IF new_parent IS DISTINCT FROM old_parent THEN PERFORM delivery_dirty_parent(new_parent); END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;

-- Per-function attestation: other freshness functions retain their current version,
-- notably the variant supplier overrides installed by the preceding migration.
COMMENT ON FUNCTION delivery_bom_changed() IS 'overseek-delivery-bom-noop-v2';
COMMENT ON FUNCTION delivery_bom_item_changed() IS 'overseek-delivery-bom-noop-v2';
