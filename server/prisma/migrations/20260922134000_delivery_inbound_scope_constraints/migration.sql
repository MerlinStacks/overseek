-- The initial two-scope outbox migration predates inbound. Preserve revision
-- constraints while replacing its original scope/entity checks, including the
-- PostgreSQL-generated name of the multi-column scope/entity constraint.
ALTER TABLE "DeliveryInputSync" DROP CONSTRAINT IF EXISTS "DeliveryInputSync_scope_check";
ALTER TABLE "DeliveryInputSync" DROP CONSTRAINT IF EXISTS "DeliveryInputSync_check1";
ALTER TABLE "DeliveryInputSync" ADD CONSTRAINT "DeliveryInputSync_scope_check"
  CHECK ("scope" IN ('settings', 'product', 'inbound'));
ALTER TABLE "DeliveryInputSync" ADD CONSTRAINT "DeliveryInputSync_entity_scope_check"
  CHECK (("scope" = 'settings' AND "entityId" = 0) OR ("scope" IN ('product', 'inbound') AND "entityId" > 0));
