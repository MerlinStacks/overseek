import { Prisma } from '@prisma/client';

// Cost-only SupplierItem/labour rows do not derive finished-product stock. Any
// inventory reference does, even an inactive, dangling, empty or ambiguous one.
// Do not join to the dependency or filter isActive: invalid references fail closed.
const stockReferences = ['childProductId', 'childVariationId', 'internalProductId'] as const;
export const stockDerivedBomItemWhere: Prisma.BOMItemWhereInput = {
    OR: stockReferences.map(field => ({ [field]: { not: null } })),
};
// Fixed internal identifiers only; the cutover query binds BOMItem with alias bi.
export const stockDerivedBomItemSql = Prisma.sql`(${Prisma.join(
    stockReferences.map(field => Prisma.sql`${Prisma.raw(`bi."${field}"`)} IS NOT NULL`), ' OR ',
)})`;
