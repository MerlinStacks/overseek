

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import type { Prisma } from '@prisma/client';


export interface CreateInternalProductData {
    name: string;
    sku?: string;
    description?: string;
    stockQuantity?: number;
    cogs?: number;
    binLocation?: string;
    mainImage?: string;
    images?: string[];
    supplierId?: string | null;
}

export interface UpdateInternalProductData {
    name?: string;
    sku?: string;
    description?: string;
    stockQuantity?: number;
    cogs?: number;
    binLocation?: string;
    mainImage?: string;
    images?: string[];
    supplierId?: string | null;
}

export interface InternalProductWithSupplier {
    id: string;
    accountId: string;
    name: string;
    sku: string | null;
    description: string | null;
    stockQuantity: number;
    cogs: number | null;
    binLocation: string | null;
    mainImage: string | null;
    images: string[];
    supplierId: string | null;
    supplier: { id: string; name: string } | null;
    createdAt: Date;
    updatedAt: Date;
    bomUsageCount?: number;
}


export class InternalProductsService {
    private static requireAccount(accountId: string): void {
        if (!accountId?.trim()) throw new Error('Account ID required');
    }


    static async list(
        accountId: string,
        options?: {
            search?: string;
            supplierId?: string;
            limit?: number;
            offset?: number;
        }
    ): Promise<{ items: InternalProductWithSupplier[]; total: number }> {
        const { search, supplierId, limit = 100, offset = 0 } = options || {};
        this.requireAccount(accountId);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 || offset > 1000000) throw new Error('Invalid product pagination');

        const where: Prisma.InternalProductWhereInput = {
            accountId,
            ...(supplierId && { supplierId }),
            ...(search && {
                OR: [
                    { name: { contains: search, mode: 'insensitive' as const } },
                    { sku: { contains: search, mode: 'insensitive' as const } },
                    { description: { contains: search, mode: 'insensitive' as const } }
                ]
            })
        };

        const [items, total] = await Promise.all([
            prisma.internalProduct.findMany({
                where,
                include: {
                    supplier: { select: { id: true, name: true } },
                    _count: { select: { bomItems: true } }
                },
                orderBy: { name: 'asc' },
                take: limit,
                skip: offset
            }),
            prisma.internalProduct.count({ where })
        ]);

        return {
            items: items.map(item => ({
                ...item,
                cogs: item.cogs ? Number(item.cogs) : null,
                images: (item.images as string[]) || [],
                bomUsageCount: item._count.bomItems
            })),
            total
        };
    }


    static async getById(id: string, accountId: string): Promise<InternalProductWithSupplier | null> {
        this.requireAccount(accountId);
        const item = await prisma.internalProduct.findFirst({
            where: { id, accountId },
            include: {
                supplier: { select: { id: true, name: true } },
                _count: { select: { bomItems: true } }
            }
        });

        if (!item) return null;

        return {
            ...item,
            cogs: item.cogs ? Number(item.cogs) : null,
            images: (item.images as string[]) || [],
            bomUsageCount: item._count.bomItems
        };
    }


    static async create(
        accountId: string,
        data: CreateInternalProductData
    ): Promise<InternalProductWithSupplier> {
        this.requireAccount(accountId);
        if (data.supplierId) {
            const supplier = await prisma.supplier.findFirst({
                where: { id: data.supplierId, accountId }
            });
            if (!supplier) {
                throw new Error('Supplier not found');
            }
        }

        const item = await prisma.internalProduct.create({
            data: {
                accountId,
                name: data.name,
                sku: data.sku || null,
                description: data.description || null,
                stockQuantity: data.stockQuantity ?? 0,
                cogs: data.cogs ?? null,
                binLocation: data.binLocation || null,
                mainImage: data.mainImage || null,
                images: (data.images || []) as Prisma.JsonArray,
                supplierId: data.supplierId || null
            },
            include: {
                supplier: { select: { id: true, name: true } },
                _count: { select: { bomItems: true } }
            }
        });

        Logger.info('[InternalProductsService] Created internal product', {
            accountId,
            productId: item.id,
            name: item.name
        });

        return {
            ...item,
            cogs: item.cogs ? Number(item.cogs) : null,
            images: (item.images as string[]) || [],
            bomUsageCount: item._count.bomItems
        };
    }


    static async update(
        id: string,
        data: UpdateInternalProductData,
        callerAccountId: string
    ): Promise<InternalProductWithSupplier> {
        this.requireAccount(callerAccountId);
        const existing = await prisma.internalProduct.findUnique({
            where: { id, accountId: callerAccountId },
            select: { accountId: true, stockQuantity: true }
        });

        if (!existing || (callerAccountId && existing.accountId !== callerAccountId)) {
            throw new Error('Internal product not found');
        }


        if (data.supplierId) {
            const supplier = await prisma.supplier.findFirst({
                where: { id: data.supplierId, accountId: existing.accountId }
            });
            if (!supplier) {
                throw new Error('Supplier not found');
            }
        }

        // Track whether stock changed so we know if cascade sync is needed
        const stockChanged = data.stockQuantity !== undefined && data.stockQuantity !== existing.stockQuantity;

        const item = await prisma.internalProduct.update({
            where: { id, accountId: callerAccountId },
            data: {
                ...(data.name !== undefined && { name: data.name }),
                ...(data.sku !== undefined && { sku: data.sku || null }),
                ...(data.description !== undefined && { description: data.description || null }),
                ...(data.stockQuantity !== undefined && { stockQuantity: data.stockQuantity }),
                ...(data.cogs !== undefined && { cogs: data.cogs }),
                ...(data.binLocation !== undefined && { binLocation: data.binLocation || null }),
                ...(data.mainImage !== undefined && { mainImage: data.mainImage || null }),
                ...(data.images !== undefined && { images: data.images as Prisma.JsonArray }),
                ...(data.supplierId !== undefined && { supplierId: data.supplierId || null })
            },
            include: {
                supplier: { select: { id: true, name: true } },
                _count: { select: { bomItems: true } }
            }
        });

        Logger.info('[InternalProductsService] Updated internal product', {
            productId: id,
            updatedFields: Object.keys(data)
        });

        // Cascade sync: if stock changed, recalculate all BOM parents that use this component
        if (stockChanged) {
            this.triggerCascadeSync(existing.accountId, id).catch((err) => {
                Logger.warn('[InternalProductsService] Cascade sync fire-and-forget failed', { productId: id, error: err?.message });
            });
        }

        return {
            ...item,
            cogs: item.cogs ? Number(item.cogs) : null,
            images: (item.images as string[]) || [],
            bomUsageCount: item._count.bomItems
        };
    }


    static async delete(id: string, callerAccountId: string): Promise<{ success: boolean; bomUsageWarning?: number }> {
        this.requireAccount(callerAccountId);
        return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "InternalProduct" WHERE id = ${id} AND "accountId" = ${callerAccountId} FOR UPDATE`;
        const existing = await tx.internalProduct.findUnique({
            where: { id, accountId: callerAccountId },
            include: { _count: { select: { bomItems: true } } }
        });

        if (!existing || (callerAccountId && existing.accountId !== callerAccountId)) {
            throw new Error('Internal product not found');
        }

        // can't delete if it's used in BOMs
        if (existing._count.bomItems > 0) {
            return {
                success: false,
                bomUsageWarning: existing._count.bomItems
            };
        }

        await tx.internalProduct.delete({ where: { id, accountId: callerAccountId } });

        Logger.info('[InternalProductsService] Deleted internal product', {
            productId: id,
            name: existing.name
        });

        return { success: true };
        });
    }


    static async forceDelete(id: string, callerAccountId: string): Promise<{ success: boolean; bomItemsRemoved: number }> {
        this.requireAccount(callerAccountId);
        const { bomItemsRemoved, parents } = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "InternalProduct" WHERE id = ${id} AND "accountId" = ${callerAccountId} FOR UPDATE`;
        const existing = await tx.internalProduct.findUnique({
            where: { id, accountId: callerAccountId },
            include: { _count: { select: { bomItems: true } } }
        });

        if (!existing || (callerAccountId && existing.accountId !== callerAccountId)) {
            throw new Error('Internal product not found');
        }


        const bomItemsRemoved = existing._count.bomItems;
        const parents = await tx.bOMItem.findMany({ where: { internalProductId: id, bom: { product: { accountId: callerAccountId } } }, select: { bom: { select: { productId: true, variationId: true } } } });
        if (parents.length !== bomItemsRemoved) throw new Error('Cannot delete a product with inconsistent BOM ownership');
        if (bomItemsRemoved > 0) {
            await tx.bOMItem.deleteMany({
                where: { internalProductId: id, bom: { product: { accountId: callerAccountId } } }
            });
        }

        await tx.internalProduct.delete({ where: { id, accountId: callerAccountId } });

        Logger.info('[InternalProductsService] Force deleted internal product', {
            productId: id,
            name: existing.name,
            bomItemsRemoved
        });

        return { bomItemsRemoved, parents };
        });
        // Discover dependencies before removing the links, then recalculate after commit.
        if (parents.length) {
        const { BOMInventorySyncService } = await import('./BOMInventorySyncService');
        const { BOMConsumptionService } = await import('./BOMConsumptionService');
        const unique = new Map(parents.map(item => [`${item.bom.productId}:${item.bom.variationId}`, item.bom]));
        for (const parent of unique.values()) {
            try {
                await BOMInventorySyncService.syncProductToWoo(callerAccountId, parent.productId, parent.variationId);
                await BOMConsumptionService.cascadeSyncAffectedProducts(callerAccountId, parent.productId, parent.variationId);
            } catch (error) { Logger.error('Failed to sync BOM after internal product deletion', { accountId: callerAccountId, parent, error }); }
        }
        }
        return { success: true, bomItemsRemoved };
    }


    static async adjustStock(
        id: string,
        adjustment: number,
        reason: string,
        source: 'USER' | 'SYSTEM_BOM' | 'SYSTEM_SYNC' = 'USER',
        callerAccountId = ''
    ): Promise<InternalProductWithSupplier> {
        this.requireAccount(callerAccountId);
        if (!Number.isInteger(adjustment) || Math.abs(adjustment) > 2147483647 || !reason.trim()) throw new Error('Invalid stock adjustment');
        const { item, existing, previousStock, newStock } = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "InternalProduct" WHERE id = ${id} AND "accountId" = ${callerAccountId} FOR UPDATE`;
        const existing = await tx.internalProduct.findUnique({
            where: { id, accountId: callerAccountId },
            select: { accountId: true, stockQuantity: true, name: true }
        });

        if (!existing || (callerAccountId && existing.accountId !== callerAccountId)) {
            throw new Error('Internal product not found');
        }

        const previousStock = existing.stockQuantity;
        const newStock = Math.max(0, previousStock + adjustment);
        if (newStock > 2147483647) throw new Error('Stock quantity exceeds numeric range');

        const item = await tx.internalProduct.update({
            where: { id, accountId: callerAccountId },
            data: { stockQuantity: newStock },
            include: {
                supplier: { select: { id: true, name: true } },
                _count: { select: { bomItems: true } }
            }
        });


        await tx.auditLog.create({ data: { accountId: callerAccountId, userId: null, action: 'UPDATE', resource: 'PRODUCT', resourceId: id, source, previousValue: { stock_quantity: previousStock }, validationStatus: 'PASSED', details: { stock_quantity: newStock, reason, adjustment, productType: 'INTERNAL', productName: existing.name } } });
        return { item, existing, previousStock, newStock };
        });

        Logger.info('[InternalProductsService] Stock adjusted', {
            productId: id,
            adjustment,
            previousStock,
            newStock,
            reason
        });

        // Cascade sync: recalculate all BOM parents that use this component
        // Skip cascade when source is SYSTEM_BOM to prevent infinite loops
        if (source !== 'SYSTEM_BOM') {
            this.triggerCascadeSync(existing.accountId, id).catch((err) => {
                Logger.warn('[InternalProductsService] Cascade sync fire-and-forget failed', { productId: id, error: err?.message });
            });
        }

        return {
            ...item,
            cogs: item.cogs ? Number(item.cogs) : null,
            images: (item.images as string[]) || [],
            bomUsageCount: item._count.bomItems
        };
    }

    /**
     * Fire-and-forget cascade sync for BOM parents using this internal product.
     * Non-blocking: errors are logged but never propagated.
     */
    private static async triggerCascadeSync(accountId: string, internalProductId: string): Promise<void> {
        try {
            const { BOMConsumptionService } = await import('./BOMConsumptionService');
            await BOMConsumptionService.cascadeSyncAffectedProducts(
                accountId,
                internalProductId,
                undefined,
                'internalProduct'
            );
        } catch (err: any) {
            Logger.warn('[InternalProductsService] Cascade sync failed for internal product', {
                internalProductId,
                error: err.message
            });
        }
    }


    static async getForBOMSelection(accountId: string): Promise<Array<{
        id: string;
        name: string;
        sku: string | null;
        stockQuantity: number;
    }>> {
        this.requireAccount(accountId);
        return prisma.internalProduct.findMany({
            where: { accountId },
            select: {
                id: true,
                name: true,
                sku: true,
                stockQuantity: true
            },
            orderBy: { name: 'asc' }
        });
    }
}
