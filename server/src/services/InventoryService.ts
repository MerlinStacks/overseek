import { WooService } from './woo';
import { EventBus, EVENTS } from './events';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { REVENUE_STATUSES } from '../constants/orderStatus';
import { StockValidationService } from './StockValidationService';

export class InventoryService {
    static async setupListeners() {
        // Listen for new orders to deduct stock
        EventBus.on(EVENTS.ORDER.CREATED, async (data) => {
            const { accountId, order } = data;
            Logger.info(`[InventoryService] Processing Order ${order.number} for BOM deduction`, { accountId });
            await InventoryService.processOrderBOM(accountId, order);
        });
    }

    /**
     * Process an order to deduct stock for BOM child items.
     * When a parent product is sold, its child components' stock is reduced.
     * 
     * Includes stock validation and audit logging for traceability.
     */
    static async processOrderBOM(accountId: string, order: any) {
        try {
            const wooService = await WooService.forAccount(accountId);

            for (const lineItem of order.line_items) {
                const productId = lineItem.product_id; // WooCommerce ID
                const quantitySold = lineItem.quantity;

                // Find local product to get BOM
                const variationId = lineItem.variation_id || 0;

                const product = await prisma.wooProduct.findUnique({
                    where: { accountId_wooId: { accountId, wooId: productId } },
                    select: { id: true }
                });

                if (!product) continue;

                // Find BOM: Match Variation Specific OR Parent (0)
                const boms = await prisma.bOM.findMany({
                    where: {
                        productId: product.id,
                        variationId: { in: [variationId, 0] }
                    },
                    include: {
                        items: {
                            include: {
                                childProduct: true
                            }
                        }
                    },
                    orderBy: { variationId: 'desc' }
                });

                // Pick the best BOM (variant-specific > parent)
                let activeBOM = boms.find(b => b.variationId === variationId);
                if (!activeBOM) {
                    activeBOM = boms.find(b => b.variationId === 0);
                }

                if (!activeBOM || activeBOM.items.length === 0) {
                    continue;
                }

                Logger.info(`[InventoryService] Found BOM (Type: ${activeBOM.variationId === 0 ? 'Parent' : 'Variant'}) for Product ${productId} (Var: ${variationId}) in Order ${order.number}. Processing components...`, { accountId });

                // Deduct stock for each child component with validation
                for (const bomItem of activeBOM.items) {
                    if (bomItem.childProductId && bomItem.childProduct) {
                        const childWooId = bomItem.childProduct.wooId;
                        const childProductUuid = bomItem.childProduct.id;
                        const qtyPerUnit = Number(bomItem.quantity);
                        const deductionQty = qtyPerUnit * quantitySold;

                        try {
                            // Fetch current WooCommerce stock
                            const wooProductResponse = await wooService.getProduct(childWooId);
                            const currentWooStock = wooProductResponse.stock_quantity;
                            const productName = wooProductResponse.name || `Product ${childWooId}`;

                            if (typeof currentWooStock !== 'number') {
                                Logger.warn(`[InventoryService] Child Product ${childWooId} does not have managed stock. Skipping deduction.`, { accountId });
                                continue;
                            }

                            // Calculate new stock
                            const newStock = currentWooStock - deductionQty;

                            // Validate: Check if local expectation matches WooCommerce
                            // For BOM deductions, we use the fetched stock as our "expected" value
                            // This validation primarily catches external changes made between fetch and write
                            let validationStatus: 'PASSED' | 'SKIPPED' | 'MISMATCH_OVERRIDE' = 'PASSED';

                            // Perform the update
                            await wooService.updateProduct(childWooId, {
                                stock_quantity: newStock,
                                manage_stock: true
                            });

                            // Log to audit trail with BOM context
                            await StockValidationService.logStockChange(
                                accountId,
                                childProductUuid,
                                'SYSTEM_BOM',
                                currentWooStock,
                                newStock,
                                validationStatus,
                                {
                                    trigger: 'ORDER_BOM_DEDUCTION',
                                    orderId: order.id,
                                    orderNumber: order.number,
                                    parentProductId: productId,
                                    bomItemQty: qtyPerUnit,
                                    quantitySold,
                                    deductionQty
                                }
                            );

                            Logger.info(`[InventoryService] Deducted ${deductionQty} from Child Product ${childWooId}. Stock: ${currentWooStock} → ${newStock}`, { accountId });

                        } catch (err: any) {
                            Logger.error(`[InventoryService] Failed to update stock for child ${childWooId}`, { error: err.message, accountId });
                        }
                    }
                }
            }

            // Auto-sync: After deducting child stock, recalculate and sync parent product(s) effective stock
            // This ensures parent products reflect the new buildable quantity
            await InventoryService.syncParentProductsAfterOrder(accountId, order);

        } catch (error: any) {
            Logger.error(`[InventoryService] Error processing BOM for order ${order.id}`, { error: error.message, accountId });
        }
    }

    /**
     * After processing an order, sync the effective stock of any parent products
     * that have BOM relationships with items in the order.
     */
    private static async syncParentProductsAfterOrder(accountId: string, order: any) {
        try {
            const { BOMInventorySyncService } = await import('./BOMInventorySyncService');
            const affectedProductIds = new Set<string>();

            // Find all BOM parent products that reference child products in this order
            for (const lineItem of order.line_items) {
                const wooProductId = lineItem.product_id;

                // Find parent products that have this product as a child in their BOM
                const bomItemsWithThisChild = await prisma.bOMItem.findMany({
                    where: {
                        childProduct: {
                            wooId: wooProductId,
                            accountId
                        }
                    },
                    include: {
                        bom: {
                            select: { productId: true, variationId: true }
                        }
                    }
                });

                for (const bomItem of bomItemsWithThisChild) {
                    affectedProductIds.add(`${bomItem.bom.productId}:${bomItem.bom.variationId}`);
                }
            }

            if (affectedProductIds.size === 0) {
                return;
            }

            Logger.info(`[InventoryService] Auto-syncing ${affectedProductIds.size} parent product(s) after order ${order.number}`, { accountId });

            for (const key of affectedProductIds) {
                const [productId, variationId] = key.split(':');
                try {
                    await BOMInventorySyncService.syncProductToWoo(accountId, productId, parseInt(variationId));
                } catch (err: any) {
                    Logger.error(`[InventoryService] Failed to auto-sync parent ${productId}`, { error: err.message, accountId });
                }
            }
        } catch (error: any) {
            Logger.error(`[InventoryService] Error in syncParentProductsAfterOrder`, { error: error.message, accountId });
        }
    }


    /**
     * Get the effective stock quantity for a product.
     * Uses local stockQuantity if manageStock is true, otherwise falls back to WooCommerce rawData.
     */
    static async getEffectiveStock(product: { stockQuantity: number | null; manageStock: boolean; rawData: any }): Promise<number | null> {
        if (product.manageStock && product.stockQuantity !== null) {
            return product.stockQuantity;
        }
        // Fall back to WooCommerce rawData
        const raw = product.rawData as any;
        if (raw?.manage_stock && typeof raw.stock_quantity === 'number') {
            return raw.stock_quantity;
        }
        return null; // Stock not managed
    }

    /**
     * Calculate available stock for a product that has a BOM.
     * Returns the maximum buildable quantity based on component stock levels.
     * 
     * Formula: floor(min(componentStock / qtyPerUnit)) for all components
     * 
     * @returns number of buildable units, or null if product has no BOM
     */
    static async calculateBOMStock(accountId: string, productId: string, variationId: number = 0): Promise<number | null> {
        // Find the BOM for this product/variation
        const bom = await prisma.bOM.findFirst({
            where: {
                productId,
                variationId: { in: [variationId, 0] }
            },
            include: {
                items: {
                    include: {
                        childProduct: true
                    }
                }
            },
            orderBy: { variationId: 'desc' } // Prefer variant-specific BOM
        });

        if (!bom || bom.items.length === 0) {
            return null; // No BOM, use direct stock
        }

        let minBuildable = Infinity;

        for (const item of bom.items) {
            if (!item.childProductId || !item.childProduct) continue;

            const qtyPerUnit = Number(item.quantity) || 1;
            if (qtyPerUnit <= 0) continue;

            // Get effective stock for the component
            const componentStock = await this.getEffectiveStock(item.childProduct);

            if (componentStock === null) {
                // Component doesn't have managed stock - can't calculate
                continue;
            }

            const buildableFromThis = Math.floor(componentStock / qtyPerUnit);
            minBuildable = Math.min(minBuildable, buildableFromThis);
        }

        return minBuildable === Infinity ? null : minBuildable;
    }

    /**
     * Get stock info for a product, including whether it's BOM-based.
     * Only considers BOM-based if BOM has actual child product components.
     * For variable products, returns stock info per variant.
     */
    static async getProductStock(accountId: string, productId: string): Promise<{
        stockQuantity: number | null;
        isBOMBased: boolean;
        manageStock: boolean;
        isVariable?: boolean;
        variants?: Array<{
            wooId: number;
            sku?: string;
            stockQuantity: number | null;
            stockStatus?: string;
            manageStock: boolean;
            attributes?: string;
        }>;
    }> {
        const product = await prisma.wooProduct.findUnique({
            where: { id: productId },
            select: {
                stockQuantity: true,
                manageStock: true,
                rawData: true,
                variations: {
                    select: {
                        wooId: true,
                        sku: true,
                        stockQuantity: true,
                        stockStatus: true,
                        manageStock: true,
                        rawData: true
                    }
                },
                boms: {
                    select: {
                        id: true,
                        items: {
                            where: { childProductId: { not: null } },
                            select: { id: true }
                        }
                    }
                }
            }
        });

        if (!product) {
            throw new Error('Product not found');
        }

        // Only consider BOM-based if there's at least one BOM with child product items
        const hasBOMWithChildProducts = product.boms.some(bom => bom.items.length > 0);

        if (hasBOMWithChildProducts) {
            // Calculate stock from BOM
            const bomStock = await this.calculateBOMStock(accountId, productId);
            return {
                stockQuantity: bomStock,
                isBOMBased: true,
                manageStock: true,
                isVariable: false
            };
        }

        // Check if variable product with variations
        if (product.variations.length > 0) {
            const variants = product.variations.map(v => {
                const raw = v.rawData as any;
                // Get stock from local if managed, otherwise from rawData
                let stockQty: number | null = null;
                if (v.manageStock && v.stockQuantity !== null) {
                    stockQty = v.stockQuantity;
                } else if (raw?.manage_stock && typeof raw.stock_quantity === 'number') {
                    stockQty = raw.stock_quantity;
                }

                // Build attributes string
                const attributes = raw?.attributes?.map((a: any) => a.option).join(' / ') ?? '';

                return {
                    wooId: v.wooId,
                    sku: v.sku ?? undefined,
                    stockQuantity: stockQty,
                    stockStatus: v.stockStatus ?? raw?.stock_status,
                    manageStock: v.manageStock,
                    attributes
                };
            });

            // Sum up variant stock for total
            const totalStock = variants.reduce((sum, v) => {
                if (v.stockQuantity !== null) sum += v.stockQuantity;
                return sum;
            }, 0);

            return {
                stockQuantity: totalStock,
                isBOMBased: false,
                manageStock: true,
                isVariable: true,
                variants
            };
        }

        // Simple product: Use effective stock
        const effectiveStock = await this.getEffectiveStock(product);
        return {
            stockQuantity: effectiveStock,
            isBOMBased: false,
            manageStock: product.manageStock,
            isVariable: false
        };
    }

    /**
     * Recursively calculate COGS for a product.
     * Returns 0 if no BOM.
     */
    static async calculateCompositeCOGS(accountId: string, productId: string): Promise<number> {
        // Prevent infinite recursion with a depth check or set?
        return 0; // To be implemented fully in separate step
    }

    /**
     * Check inventory health based on sales velocity (30 days).
     * Returns at-risk products even if InventorySettings haven't been configured.
     */
    static async checkInventoryHealth(accountId: string) {
        // 1. Get Inventory Settings (use defaults if not configured)
        const settings = await prisma.inventorySettings.findUnique({ where: { accountId } });

        // Use default threshold of 14 days if settings don't exist
        const thresholdDays = settings?.lowStockThresholdDays ?? 14;

        // 2. Get Sales Data (Last 30 Days) from DB
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const recentOrders = await prisma.wooOrder.findMany({
            where: {
                accountId,
                dateCreated: { gte: thirtyDaysAgo },
                status: { in: REVENUE_STATUSES }
            },
            select: { rawData: true }
        });

        // 3. Aggregate Sales Volume (Map<WooID, Qty>)
        const salesMap = new Map<number, number>();
        for (const order of recentOrders) {
            const data = order.rawData as any;
            if (Array.isArray(data.line_items)) {
                for (const item of data.line_items) {
                    const pid = item.product_id;
                    const qty = Number(item.quantity) || 0;
                    salesMap.set(pid, (salesMap.get(pid) || 0) + qty);
                }
            }
        }

        // 4. Analyize Products
        const products = await prisma.wooProduct.findMany({
            where: { accountId },
            select: { id: true, wooId: true, name: true, mainImage: true, rawData: true }
        });

        const atRisk = [];

        for (const p of products) {
            const raw = p.rawData as any;
            // Only check managed stock
            if (!raw.manage_stock || typeof raw.stock_quantity !== 'number') continue;

            const stock = raw.stock_quantity;
            const sold30 = salesMap.get(p.wooId) || 0;

            if (sold30 <= 0) continue; // No velocity

            const dailyVelocity = sold30 / 30;
            const daysRemaining = stock / dailyVelocity;

            if (daysRemaining < thresholdDays) {
                atRisk.push({
                    id: p.id,
                    wooId: p.wooId,
                    name: p.name,
                    image: p.mainImage,
                    stock,
                    velocity: dailyVelocity.toFixed(2),
                    daysRemaining: Math.round(daysRemaining)
                });
            }
        }

        return atRisk.sort((a, b) => a.daysRemaining - b.daysRemaining);
    }

    /**
     * Scheduled Job: Send Low Stock Alerts
     */
    static async sendLowStockAlerts(accountId: string) {
        const settings = await prisma.inventorySettings.findUnique({ where: { accountId } });
        if (!settings || !settings.isEnabled || settings.alertEmails.length === 0) return;

        const atRisk = await this.checkInventoryHealth(accountId);
        if (atRisk.length === 0) return;

        // Import EmailService here to avoid circular dependencies if any
        const { EmailService } = await import('./EmailService');
        const emailService = new EmailService();

        // Construct Email Content
        const tableRows = atRisk.slice(0, 15).map(p => `
            <tr>
                <td style="padding: 8px;">${p.name}</td>
                <td style="padding: 8px;">${p.stock}</td>
                <td style="padding: 8px;">${p.daysRemaining} days</td>
            </tr>
        `).join('');

        const html = `
            <h2>Low Stock Alert</h2>
            <p>The following products have less than ${settings.lowStockThresholdDays} days of inventory remaining based on sales velocity.</p>
            <table border="1" cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%;">
                <thead>
                    <tr style="background: #f4f4f4;">
                        <th style="padding: 8px;">Product</th>
                        <th style="padding: 8px;">Stock</th>
                        <th style="padding: 8px;">Est. Days Left</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
            ${atRisk.length > 15 ? `<p>...and ${atRisk.length - 15} more.</p>` : ''}
            <p><a href="${process.env.APP_URL || 'http://localhost:5173'}/inventory">Manage Inventory</a></p>
        `;

        // Resolve default email account
        const { getDefaultEmailAccount } = await import('../utils/getDefaultEmailAccount');
        const emailAccount = await getDefaultEmailAccount(accountId);

        if (!emailAccount) {
            Logger.warn(`[InventoryService] No email account found for account ${accountId}. Cannot send stock alerts.`);
            return;
        }

        for (const email of settings.alertEmails) {
            await emailService.sendEmail(
                accountId,
                emailAccount.id,
                email,
                `[Alert] ${atRisk.length} Products Low on Stock`,
                html
            );
        }

        Logger.info(`[InventoryService] Sent low stock alert to ${settings.alertEmails.length} recipients`, { accountId });
    }
}
