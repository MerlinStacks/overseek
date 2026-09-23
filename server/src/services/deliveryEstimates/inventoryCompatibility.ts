import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';

/** Inventory cutover policy, distinct from delivery/BOM date eligibility. No remote writes.
 * Custom catalogue types are incompatible account-wide; unmanaged/fractional native
 * products are flagged when they are actual PO or BOM-component inventory targets.
 */
export async function checkInventoryCompatibility(accountId: string, db: Prisma.TransactionClient = prisma) {
    const rows = await db.$queryRaw<Array<{ productWooId: number; variationWooId: number | null; reason: string; total: bigint }>>`
      WITH direct_products AS (
        SELECT p.* FROM "WooProduct" p WHERE p."accountId"=${accountId}
        AND NOT EXISTS (SELECT 1 FROM "BOM" b JOIN "BOMItem" bi ON bi."bomId"=b.id WHERE b."productId"=p.id
          AND (bi."childProductId" IS NOT NULL OR bi."internalProductId" IS NOT NULL))
      ), incompatible AS (
        SELECT p."wooId" AS "productWooId", NULL::int AS "variationWooId",
          CASE WHEN COALESCE(p."rawData"->>'type','') NOT IN ('simple','variable') THEN 'unsupported_native_stock_type'
            WHEN NOT p."manageStock" OR p."rawData"->>'manage_stock' IS DISTINCT FROM 'true' THEN 'enable_native_stock_management'
            ELSE 'fractional_stock_requires_supported_protocol' END AS reason
        FROM direct_products p WHERE COALESCE(p."rawData"->>'type','') NOT IN ('simple','variable')
        OR (p."rawData"->>'type'='simple'
          AND (EXISTS (SELECT 1 FROM "PurchaseOrderItem" i JOIN "PurchaseOrder" po ON po.id=i."purchaseOrderId"
            WHERE i."productId"=p.id AND po."accountId"=${accountId} AND po.status IN ('DRAFT','ORDERED'))
           OR EXISTS (SELECT 1 FROM "BOMItem" bi JOIN "BOM" b ON b.id=bi."bomId" JOIN "WooProduct" target ON target.id=b."productId"
            WHERE bi."childProductId"=p.id AND bi."isActive" AND target."accountId"=${accountId}))
          AND (NOT p."manageStock" OR p."rawData"->>'manage_stock' IS DISTINCT FROM 'true'
            OR CASE WHEN jsonb_typeof(p."rawData"->'stock_quantity')='number'
              THEN (p."rawData"->>'stock_quantity')::numeric <> trunc((p."rawData"->>'stock_quantity')::numeric) ELSE false END))
        UNION ALL
        SELECT p."wooId", v."wooId", 'enable_or_verify_native_variation_stock' FROM direct_products p
        JOIN "ProductVariation" v ON v."productId"=p.id
        WHERE (EXISTS (SELECT 1 FROM "PurchaseOrderItem" i JOIN "PurchaseOrder" po ON po.id=i."purchaseOrderId"
          WHERE i."productId"=p.id AND i."variationWooId"=v."wooId" AND po."accountId"=${accountId} AND po.status IN ('DRAFT','ORDERED'))
         OR EXISTS (SELECT 1 FROM "BOMItem" bi JOIN "BOM" b ON b.id=bi."bomId" JOIN "WooProduct" target ON target.id=b."productId"
          WHERE bi."childProductId"=p.id AND bi."childVariationId"=v."wooId" AND bi."isActive" AND target."accountId"=${accountId}))
        AND NOT COALESCE(((v."manageStock" AND v."rawData"->>'manage_stock'='true') OR
          (v."rawData"->>'manage_stock' IN ('false','parent') AND p."manageStock" AND p."rawData"->>'manage_stock'='true')), false)
        UNION ALL
        SELECT p."wooId", NULL::int, 'configure_variation_bom_instead_of_unsupported_parent_cascade'
        FROM "WooProduct" p WHERE p."accountId"=${accountId} AND p."rawData"->>'type'='variable'
        AND EXISTS (SELECT 1 FROM "BOM" b JOIN "BOMItem" bi ON bi."bomId"=b.id WHERE b."productId"=p.id
          AND b."variationId"=0 AND bi."isActive" AND bi."childProductId" IS NOT NULL)
        UNION ALL
        SELECT p."wooId", NULL::int, 'reference_component_variation_or_enable_parent_stock'
        FROM direct_products p WHERE p."rawData"->>'type'='variable'
        AND (NOT p."manageStock" OR p."rawData"->>'manage_stock' IS DISTINCT FROM 'true')
        AND EXISTS (SELECT 1 FROM "BOMItem" bi JOIN "BOM" b ON b.id=bi."bomId" JOIN "WooProduct" target ON target.id=b."productId"
          WHERE bi."childProductId"=p.id AND bi."childVariationId" IS NULL AND bi."isActive" AND target."accountId"=${accountId})
        UNION ALL
        SELECT p."wooId", bi."childVariationId", 'whole_unit_bom_deductions_required'
        FROM "BOMItem" bi JOIN "BOM" b ON b.id=bi."bomId" JOIN "WooProduct" target ON target.id=b."productId"
        JOIN "WooProduct" p ON p.id=bi."childProductId"
        WHERE target."accountId"=${accountId} AND bi."isActive" AND
          (bi.quantity*(1+bi."wasteFactor")<=0 OR bi.quantity*(1+bi."wasteFactor")>1000000
           OR bi.quantity*(1+bi."wasteFactor")<>trunc(bi.quantity*(1+bi."wasteFactor")))
      ) SELECT *, COUNT(*) OVER() AS total FROM incompatible ORDER BY "productWooId", "variationWooId" NULLS FIRST LIMIT 100`;
    return { ready: rows.length === 0, blockedCount: Number(rows[0]?.total ?? 0),
        targets: rows.map(({ productWooId, variationWooId, reason }) => ({ productWooId, variationWooId, reason })) };
}
