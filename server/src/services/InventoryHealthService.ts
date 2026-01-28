/**
 * Inventory Health Service
 * 
 * Analyzes inventory health based on sales velocity and sends low stock alerts.
 * Extracted from InventoryService.ts for maintainability.
 */

import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { REVENUE_STATUSES } from '../constants/orderStatus';

interface AtRiskProduct {
    id: string;
    wooId: number;
    name: string;
    image: string | null;
    stock: number;
    velocity: string;
    daysRemaining: number;
}

/**
 * Check inventory health based on sales velocity (30 days).
 * Returns at-risk products even if InventorySettings haven't been configured.
 */
export async function checkInventoryHealth(accountId: string): Promise<AtRiskProduct[]> {
    // Get Inventory Settings (use defaults if not configured)
    const settings = await prisma.inventorySettings.findUnique({ where: { accountId } });

    // Use default threshold of 14 days if settings don't exist
    const thresholdDays = settings?.lowStockThresholdDays ?? 14;

    // Get Sales Data (Last 30 Days) from DB
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

    // Aggregate Sales Volume (Map<WooID, Qty>)
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

    // Analyze Products
    const products = await prisma.wooProduct.findMany({
        where: { accountId },
        select: { id: true, wooId: true, name: true, mainImage: true, rawData: true }
    });

    const atRisk: AtRiskProduct[] = [];

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
 * Sends email alerts to configured recipients when products are running low.
 */
export async function sendLowStockAlerts(accountId: string): Promise<void> {
    const settings = await prisma.inventorySettings.findUnique({ where: { accountId } });
    if (!settings || !settings.isEnabled || settings.alertEmails.length === 0) return;

    const atRisk = await checkInventoryHealth(accountId);
    if (atRisk.length === 0) return;

    // Import EmailService here to avoid circular dependencies
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
        Logger.warn(`[InventoryHealthService] No email account found for account ${accountId}. Cannot send stock alerts.`);
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

    Logger.info(`[InventoryHealthService] Sent low stock alert to ${settings.alertEmails.length} recipients`, { accountId });
}
