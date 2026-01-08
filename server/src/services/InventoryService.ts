import { WooService } from './woo';
import { EventBus, EVENTS } from './events';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

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
     */
    static async processOrderBOM(accountId: string, order: any) {
        try {
            const wooService = await WooService.forAccount(accountId);

            for (const lineItem of order.line_items) {
                const productId = lineItem.product_id; // WooCommerce ID
                const quantitySold = lineItem.quantity;

                // Find local product to get BOM
                // Try to find BOM for specific variant first, then fallback to parent
                const variationId = lineItem.variation_id || 0;

                // We first get the product without BOM relation to check existence
                // Then separate query for BOM because of the conditional logic? 
                // Or just query for both potential BOMs and pick one in memory.

                const product = await prisma.wooProduct.findUnique({
                    where: { accountId_wooId: { accountId, wooId: productId } },
                    select: { id: true } // just get UUID
                });

                if (!product) continue;

                // Find BOM: Match Variation Specific OR Parent (0)
                // Priority: Specific > Parent
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
                    orderBy: { variationId: 'desc' } // Specific (usually > 0) comes before 0 if both exist? 
                    // Wait, if variationId is 0, then we want 0. If variationId is 123, we want 123. 
                    // If 123 is missing, do we want 0? Yes, standard inheritance.
                    // If logic is: "Variant overrides Parent", then yes.
                    // If logic is: "Variant inherits Parent + Extras", that's complex. 
                    // Let's assume OVERRIDE/FALLBACK.
                    // So we sort by variationId desc? 
                    // If we have [123, 0], we want 123. 
                    // If we have [0], we want 0. 
                    // So descending sort works if we assume 0 is always there? 
                    // No, variationId=0 might not exist either.
                    // But if both exist, 123 > 0.
                });

                // Pick the best BOM
                // If we have a BOM for the exact variationId, use it.
                // Else if we have a BOM for 0 (parent), use it.
                let activeBOM = boms.find(b => b.variationId === variationId);
                if (!activeBOM) {
                    activeBOM = boms.find(b => b.variationId === 0);
                }

                if (!activeBOM || activeBOM.items.length === 0) {
                    continue;
                }

                Logger.info(`[InventoryService] Found BOM (Type: ${activeBOM.variationId === 0 ? 'Parent' : 'Variant'}) for Product ${productId} (Var: ${variationId}) in Order ${order.number}. Processing components...`, { accountId });

                // Deduct stock for each child component
                for (const bomItem of activeBOM.items) {
                    if (bomItem.childProductId && bomItem.childProduct) {
                        const childWooId = bomItem.childProduct.wooId;
                        const qtyPerUnit = Number(bomItem.quantity);
                        const deductionQty = qtyPerUnit * quantitySold;

                        try {
                            // Fetch raw from Woo to be safe and atomic-ish
                            // We need to implement getProduct or use raw Woo client if available, but for now assuming wooService.getProduct exists as established in previous logic
                            const wooProductResponse = await wooService.getProduct(childWooId);
                            const currentWooStock = wooProductResponse.stock_quantity;

                            if (typeof currentWooStock === 'number') {
                                const newStock = currentWooStock - deductionQty;
                                await wooService.updateProduct(childWooId, {
                                    stock_quantity: newStock,
                                    manage_stock: true
                                });
                                Logger.info(`[InventoryService] Deducted ${deductionQty} from Child Product ${childWooId}. New Stock: ${newStock}`, { accountId });
                            } else {
                                Logger.warn(`[InventoryService] Child Product ${childWooId} does not have managed stock. Skipping deduction.`, { accountId });
                            }

                        } catch (err: any) {
                            Logger.error(`[InventoryService] Failed to update stock for child ${childWooId}`, { error: err.message, accountId });
                        }
                    }
                }
            }
        } catch (error: any) {
            Logger.error(`[InventoryService] Error processing BOM for order ${order.id}`, { error: error.message, accountId });
        }
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
                status: { in: ['completed', 'processing', 'on-hold'] }
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
            <p><a href="https://app.overseek.com/inventory">Manage Inventory</a></p>
        `;

        // Resolve default email account
        const emailAccount = await prisma.emailAccount.findFirst({
            where: { accountId }
        });

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
