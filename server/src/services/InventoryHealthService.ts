/**
 * Inventory Health Service
 * 
 * Analyzes inventory health based on sales velocity and sends low stock alerts.
 * Extracted from InventoryService.ts for maintainability.
 */

import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { REVENUE_STATUSES } from '../constants/orderStatus';

function positiveNumber(value: unknown): number | null {
    const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
    return Number.isFinite(number) && number > 0 ? number : null;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

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
    if (!accountId?.trim()) throw new Error('Account ID required');
    // Get Inventory Settings (use defaults if not configured)
    const settings = await prisma.inventorySettings.findUnique({ where: { accountId } });

    // Use default threshold of 14 days if settings don't exist
    const thresholdDays = positiveNumber(settings?.lowStockThresholdDays) ?? 14;

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
    const variationSales = new Map<string, number>();
    for (const order of recentOrders) {
        const data = order.rawData as any;
        if (Array.isArray(data?.line_items)) {
            for (const item of data.line_items) {
                if (!item || typeof item !== 'object') continue;
                const pid = positiveNumber(item.product_id);
                const qty = positiveNumber(item.quantity);
                if (!pid || !Number.isInteger(pid) || !qty) continue;
                const total = (salesMap.get(pid) || 0) + qty;
                if (Number.isFinite(total)) salesMap.set(pid, total);
                const vid = positiveNumber(item.variation_id);
                if (vid && Number.isInteger(vid)) {
                    const key = `${pid}:${vid}`;
                    const variantTotal = (variationSales.get(key) || 0) + qty;
                    if (Number.isFinite(variantTotal)) variationSales.set(key, variantTotal);
                }
            }
        }
    }

    // Analyze Products (parent-level stock)
    const products = await prisma.wooProduct.findMany({
        where: { accountId },
        select: { id: true, wooId: true, name: true, mainImage: true, rawData: true, manageStock: true, stockQuantity: true }
    });

    const atRisk: AtRiskProduct[] = [];

    for (const p of products) {
        const raw = p.rawData as any;
        // Prioritize materialized DB field, fall back to rawData
        const managesStock = p.manageStock ?? raw?.manage_stock;
        const stock = p.stockQuantity ?? raw?.stock_quantity;
        if (managesStock !== true || typeof stock !== 'number' || !Number.isFinite(stock)) continue;

        const sold30 = salesMap.get(p.wooId) || 0;

        if (sold30 <= 0) continue; // No velocity

        const dailyVelocity = sold30 / 30;
        const daysRemaining = Math.max(0, stock) / dailyVelocity;

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

    // Analyze Variants — variable products often only manage stock at the variant level
    const variations = await prisma.productVariation.findMany({
        where: {
            product: { accountId },
            manageStock: true,
            stockQuantity: { not: null }
        },
        select: {
            wooId: true,
            stockQuantity: true,
            sku: true,
            product: { select: { id: true, wooId: true, name: true, mainImage: true } }
        }
    });

    for (const v of variations) {
        const stock = v.stockQuantity ?? 0;
        if (!Number.isFinite(stock)) continue;
        const sold30 = variationSales.get(`${v.product.wooId}:${v.wooId}`) || 0;
        if (sold30 <= 0) continue;

        const dailyVelocity = sold30 / 30;
        const daysRemaining = Math.max(0, stock) / dailyVelocity;

        if (daysRemaining < thresholdDays) {
            atRisk.push({
                id: v.product.id,
                wooId: v.wooId,
                name: v.sku ? `${v.product.name} (${v.sku})` : v.product.name,
                image: v.product.mainImage,
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
    if (!accountId?.trim()) throw new Error('Account ID required');
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
            <td style="padding: 8px;">${escapeHtml(p.name)}</td>
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
        <p><a href="${escapeHtml(process.env.APP_URL || 'http://localhost:5173')}/inventory">Manage Inventory</a></p>
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
