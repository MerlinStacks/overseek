import { PrismaClient, PurchaseOrder, PurchaseOrderItem } from '@prisma/client';
import { prisma } from '../utils/prisma';

export class PurchaseOrderService {

    /**
     * List Purchase Orders for an account with optional status filtering
     */
    async listPurchaseOrders(accountId: string, status?: string) {
        return prisma.purchaseOrder.findMany({
            where: {
                accountId,
                ...(status ? { status } : {})
            },
            include: {
                supplier: true,
                items: true
            },
            orderBy: { createdAt: 'desc' }
        });
    }

    /**
     * Get a single Purchase Order by ID
     */
    async getPurchaseOrder(accountId: string, poId: string) {
        return prisma.purchaseOrder.findFirst({
            where: { id: poId, accountId },
            include: {
                supplier: true,
                items: {
                    include: {
                        product: true,
                        supplierItem: true
                    }
                }
            }
        });
    }

    /**
     * Create a new Purchase Order
     */
    async createPurchaseOrder(accountId: string, data: {
        supplierId: string;
        items: {
            productId?: string;
            supplierItemId?: string;
            quantity: number;
            unitCost: number;
            name: string;
            sku?: string;
        }[];
        notes?: string;
        expectedDate?: string; // ISO Date string
    }) {
        // Calculate totals
        let totalAmount = 0;
        const itemsToCreate = data.items.map(item => {
            const lineTotal = item.quantity * item.unitCost;
            totalAmount += lineTotal;
            return {
                productId: item.productId,
                supplierItemId: item.supplierItemId,
                quantity: item.quantity,
                unitCost: item.unitCost, // Decimal handling? Prisma handles primitive numbers to Decimal often, but better to be safe
                totalCost: lineTotal,
                name: item.name,
                sku: item.sku
            };
        });

        return prisma.purchaseOrder.create({
            data: {
                accountId,
                supplierId: data.supplierId,
                status: 'DRAFT',
                notes: data.notes,
                expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
                totalAmount,
                items: {
                    create: itemsToCreate
                }
            }
        });
    }

    /**
     * Update a Purchase Order (Status or Fields)
     */
    async updatePurchaseOrder(accountId: string, poId: string, data: {
        status?: string;
        notes?: string;
        expectedDate?: string;
    }) {
        return prisma.purchaseOrder.updateMany({ // Use updateMany for security (accountId check)
            where: { id: poId, accountId },
            data: {
                ...(data.status ? { status: data.status } : {}),
                ...(data.notes !== undefined ? { notes: data.notes } : {}),
                ...(data.expectedDate ? { expectedDate: new Date(data.expectedDate) } : {})
            }
        });
    }

    /**
     * Calculate Inbound Inventory Quantity for a specific Product
     * Sums quantity from POs with status 'ORDERED'
     */
    async getInboundInventory(accountId: string, productId: string): Promise<number> {
        const aggregations = await prisma.purchaseOrderItem.aggregate({
            where: {
                productId,
                purchaseOrder: {
                    accountId,
                    status: 'ORDERED'
                }
            },
            _sum: {
                quantity: true
            }
        });

        return aggregations._sum.quantity || 0;
    }
}
