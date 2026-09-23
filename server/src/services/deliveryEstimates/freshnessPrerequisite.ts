import { prisma } from '../../utils/prisma';

export const FRESHNESS_SQL_VERSION = 'overseek-delivery-freshness-v1';
export const FRESHNESS_PREREQUISITE_CACHE_MS = 15_000;

/** Static catalog query: checks exact table/trigger/function bindings in the active
 * application schema, row timing/events, enabled state, payload column restriction,
 * function signatures and migration-owned version markers. No catalogue row scan.
 * No dependency on _prisma_migrations or the presence of Prisma-managed columns.
 */
export const FRESHNESS_PREREQUISITE_SQL = `
WITH expected_triggers(table_name, trigger_name, function_name, trigger_type, column_name) AS (VALUES
 ('WooProduct','delivery_product_write','delivery_product_changed',21,''),
 ('WooProduct','delivery_product_identity','delivery_product_changed',19,''),
 ('WooProduct','delivery_product_delete','delivery_product_changed',11,''),
 ('ProductVariation','delivery_variation_write','delivery_variation_changed',21,''),
 ('ProductVariation','delivery_variation_delete','delivery_variation_changed',11,''),
 ('BOM','delivery_bom_write','delivery_bom_changed',29,''),
 ('BOMItem','delivery_bom_item_write','delivery_bom_item_changed',29,''),
 ('Supplier','delivery_supplier_write','delivery_supplier_changed',17,''),
 ('Supplier','delivery_supplier_delete','delivery_supplier_changed',11,''),
 ('PurchaseOrder','delivery_po_write','delivery_po_changed',17,''),
 ('PurchaseOrder','delivery_po_delete','delivery_po_changed',11,''),
 ('PurchaseOrderItem','delivery_po_item_write','delivery_po_item_changed',29,''),
 ('DeliverySyncAccount','delivery_renewal_capability','delivery_renewal_capability_changed',21,''),
 ('AccountFeature','delivery_renewal_feature','delivery_renewal_feature_changed',29,''),
 ('DeliveryInputSync','delivery_renewal_payload','delivery_renewal_payload_written',23,'payload')
), expected_functions(function_name, arg_types, result_type) AS (VALUES
 ('delivery_dirty_parent','text','void'), ('delivery_product_changed','','trigger'),
 ('delivery_variation_changed','','trigger'), ('delivery_bom_changed','','trigger'),
 ('delivery_bom_item_changed','','trigger'), ('delivery_supplier_changed','','trigger'),
 ('delivery_po_changed','','trigger'), ('delivery_po_item_changed','','trigger'),
 ('delivery_renewal_allowed','text','boolean'), ('delivery_reset_renewals','text','void'),
 ('delivery_renewal_capability_changed','','trigger'), ('delivery_renewal_feature_changed','','trigger'),
 ('delivery_renewal_payload_written','','trigger'), ('delivery_freshness_version','','text')
)
SELECT 'trigger:' || e.table_name || '.' || e.trigger_name AS missing
FROM expected_triggers e WHERE NOT EXISTS (
 SELECT 1 FROM pg_catalog.pg_trigger t
 JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
 JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
 WHERE n.nspname = current_schema() AND c.relname = e.table_name
   AND t.tgname = e.trigger_name AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
   AND t.tgnargs = 0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
   AND ((e.trigger_name <> 'delivery_product_identity' AND t.tgqual IS NULL)
     OR (e.trigger_name = 'delivery_product_identity' AND POSITION(
       'WHEN (((old."accountId" IS DISTINCT FROM new."accountId") OR (old."wooId" IS DISTINCT FROM new."wooId")))'
       IN pg_catalog.pg_get_triggerdef(t.oid)) > 0))
   AND t.tgtype = e.trigger_type AND p.pronamespace = n.oid AND p.proname = e.function_name
   AND p.pronargs = 0 AND p.prorettype = 'pg_catalog.trigger'::regtype
   AND ((e.column_name = '' AND t.tgattr::text = '') OR t.tgattr::text =
       (SELECT a.attnum::text FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attname = e.column_name AND NOT a.attisdropped))
)
UNION ALL
SELECT 'function:' || e.function_name FROM expected_functions e WHERE NOT EXISTS (
 SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = current_schema() AND p.proname = e.function_name
   AND pg_catalog.oidvectortypes(p.proargtypes) = e.arg_types
   AND pg_catalog.format_type(p.prorettype, NULL) = e.result_type
   AND pg_catalog.obj_description(p.oid, 'pg_proc') = '${FRESHNESS_SQL_VERSION}'
   AND (e.function_name <> 'delivery_freshness_version' OR trim(p.prosrc) = 'SELECT ''${FRESHNESS_SQL_VERSION}''::text')
)
ORDER BY missing`;

export type FreshnessPrerequisite = { ready: boolean; version: string; missing: string[]; diagnostic: string | null };

/** Cache only these bounded admin/control diagnostics, never storefront requests.
 * A failed introspection also fails closed; concurrent calls share one query.
 */
export function createFreshnessPrerequisiteCheck(query: () => Promise<{ missing: string }[]>, now = Date.now) {
    let cache: { value: FreshnessPrerequisite; expiresAt: number } | undefined;
    let pending: Promise<FreshnessPrerequisite> | undefined;
    return async (): Promise<FreshnessPrerequisite> => {
        if (cache && cache.expiresAt > now()) return cache.value;
        if (pending) return pending;
        pending = (async () => {
            let value: FreshnessPrerequisite;
            try {
                const missing = (await query()).map(row => row.missing);
                value = { ready: missing.length === 0, version: FRESHNESS_SQL_VERSION, missing,
                    diagnostic: missing.length ? 'Delivery freshness SQL prerequisites are missing or outdated. Apply the delivery SQL migrations; schema push alone is insufficient.' : null };
            } catch {
                value = { ready: false, version: FRESHNESS_SQL_VERSION, missing: ['catalog_check_unavailable'],
                    diagnostic: 'Unable to verify delivery freshness SQL prerequisites. Check database access and apply the delivery SQL migrations.' };
            }
            cache = { value, expiresAt: now() + FRESHNESS_PREREQUISITE_CACHE_MS };
            return value;
        })();
        try { return await pending; } finally { pending = undefined; }
    };
}

// Query is a fixed internal string; no account, request or user text is interpolated.
const cachedFreshnessPrerequisite = createFreshnessPrerequisiteCheck(
    () => prisma.$queryRawUnsafe<{ missing: string }[]>(FRESHNESS_PREREQUISITE_SQL),
);

/** Critical cutover boundaries bypass the diagnostic cache and can use the caller's
 * transaction connection (including single-connection pools). Readiness keeps its
 * existing short, coalesced cache. SQL and failure diagnostics are shared unchanged.
 */
export function checkFreshnessPrerequisite(options?: { fresh?: boolean; db?: Pick<typeof prisma, '$queryRawUnsafe'> }) {
    if (!options?.fresh && !options?.db) return cachedFreshnessPrerequisite();
    const db = options?.db ?? prisma;
    return createFreshnessPrerequisiteCheck(() => db.$queryRawUnsafe<{ missing: string }[]>(FRESHNESS_PREREQUISITE_SQL))();
}
