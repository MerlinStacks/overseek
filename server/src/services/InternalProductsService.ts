

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { StockValidationService } from './StockValidationService';
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
    supplierId?: string;
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
    supplierId?: string;
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


    static async getById(id: string): Promise<InternalProductWithSupplier | null> {
        const item = await prisma.internalProduct.findUnique({
            where: { id },
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
        data: UpdateInternalProductData
    ): Promise<InternalProductWithSupplier> {
        const existing = await prisma.internalProduct.findUnique({
            where: { id },
            select: { accountId: true, stockQuantity: true }
        });

        if (!existing) {
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
            where: { id },
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
            this.triggerCascadeSync(existing.accountId, id).catch(() => { });
        }

        return {
            ...item,
            cogs: item.cogs ? Number(item.cogs) : null,
            images: (item.images as string[]) || [],
            bomUsageCount: item._count.bomItems
        };
    }


    static async delete(id: string): Promise<{ success: boolean; bomUsageWarning?: number }> {
        const existing = await prisma.internalProduct.findUnique({
            where: { id },
            include: { _count: { select: { bomItems: true } } }
        });

        if (!existing) {
            throw new Error('Internal product not found');
        }

        // can't delete if it's used in BOMs
        if (existing._count.bomItems > 0) {
            return {
                success: false,
                bomUsageWarning: existing._count.bomItems
            };
        }

        await prisma.internalProduct.delete({ where: { id } });

        Logger.info('[InternalProductsService] Deleted internal product', {
            productId: id,
            name: existing.name
        });

        return { success: true };
    }


    static async forceDelete(id: string): Promise<{ success: boolean; bomItemsRemoved: number }> {
        const existing = await prisma.internalProduct.findUnique({
            where: { id },
            include: { _count: { select: { bomItems: true } } }
        });

        if (!existing) {
            throw new Error('Internal product not found');
        }


        const bomItemsRemoved = existing._count.bomItems;
        if (bomItemsRemoved > 0) {
            await prisma.bOMItem.deleteMany({
                where: { internalProductId: id }
            });
        }

        await prisma.internalProduct.delete({ where: { id } });

        Logger.info('[InternalProductsService] Force deleted internal product', {
            productId: id,
            name: existing.name,
            bomItemsRemoved
        });

        return { success: true, bomItemsRemoved };
    }


    static async adjustStock(
        id: string,
        adjustment: number,
        reason: string,
        source: 'USER' | 'SYSTEM_BOM' | 'SYSTEM_SYNC' = 'USER'
    ): Promise<InternalProductWithSupplier> {
        const existing = await prisma.internalProduct.findUnique({
            where: { id },
            select: { accountId: true, stockQuantity: true, name: true }
        });

        if (!existing) {
            throw new Error('Internal product not found');
        }

        const previousStock = existing.stockQuantity;
        const newStock = Math.max(0, previousStock + adjustment);

        const item = await prisma.internalProduct.update({
            where: { id },
            data: { stockQuantity: newStock },
            include: {
                supplier: { select: { id: true, name: true } },
                _count: { select: { bomItems: true } }
            }
        });


        await StockValidationService.logStockChange(
            existing.accountId,
            id,
            source,
            previousStock,
            newStock,
            'PASSED',
            {
                reason,
                adjustment,
                productType: 'INTERNAL',
                productName: existing.name
            }
        );

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
            this.triggerCascadeSync(existing.accountId, id).catch(() => { });
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
