-- Catalog marker belongs to the SQL implementation, not the Prisma table schema.
-- A db-push-only deployment must never qualify for storefront activation.
CREATE FUNCTION delivery_freshness_version() RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT 'overseek-delivery-freshness-v1'::text$$;
COMMENT ON FUNCTION delivery_freshness_version() IS 'overseek-delivery-freshness-v1';
COMMENT ON FUNCTION delivery_dirty_parent(text) IS 'overseek-delivery-freshness-v1';
COMMENT ON FUNCTION delivery_product_changed() IS 'overseek-delivery-freshness-v1';
COMMENT ON FUNCTION delivery_variation_changed() IS 'overseek-delivery-freshness-v1';
COMMENT ON FUNCTION delivery_bom_changed() IS 'overseek-delivery-freshness-v1';
COMMENT ON FUNCTION delivery_bom_item_changed() IS 'overseek-delivery-freshness-v1';
COMMENT ON FUNCTION delivery_supplier_changed() IS 'overseek-delivery-freshness-v1';
COMMENT ON FUNCTION delivery_po_changed() IS 'overseek-delivery-freshness-v1';
COMMENT ON FUNCTION delivery_po_item_changed() IS 'overseek-delivery-freshness-v1';
COMMENT ON FUNCTION delivery_renewal_allowed(text) IS 'overseek-delivery-freshness-v1';
COMMENT ON FUNCTION delivery_reset_renewals(text) IS 'overseek-delivery-freshness-v1';
COMMENT ON FUNCTION delivery_renewal_capability_changed() IS 'overseek-delivery-freshness-v1';
COMMENT ON FUNCTION delivery_renewal_feature_changed() IS 'overseek-delivery-freshness-v1';
COMMENT ON FUNCTION delivery_renewal_payload_written() IS 'overseek-delivery-freshness-v1';
