import { prisma } from '../utils/prisma';
import { z } from 'zod';
const keys = ['total-sales', 'recent-orders', 'marketing-roas', 'live-analytics', 'top-products', 'customer-growth', 'sales-chart', 'inventory-risk', 'live-carts', 'visitor-log', 'ecommerce-log', 'hot-cache', 'quick-products', 'visitor-count', 'open-inbox', 'ad-suggestions', 'cart-abandonment', 'gold-price-margin', 'seo-keywords', 'email-log', 'status-center', 'funnel', 'analytics-stats', 'utm-campaigns'] as const;
function json(value: unknown, depth = 0): boolean {
    if (depth > 6) return false;
    if (value === null || typeof value === 'string' && value.length <= 5000 || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return true;
    if (Array.isArray(value)) return value.length <= 100 && value.every(item => json(item, depth + 1));
    return !!value && typeof value === 'object' && Object.entries(value).length <= 100 && Object.entries(value).every(([key, item]) => key.length <= 80 && !['__proto__', 'prototype', 'constructor'].includes(key) && json(item, depth + 1));
}
export const layoutSchema = z.object({ version: z.string().datetime(), widgets: z.array(z.object({
    widgetKey: z.enum(keys), position: z.object({ x: z.number().int().min(0).max(11), y: z.number().int().min(0).max(2000), w: z.number().int().min(1).max(12), h: z.number().int().min(1).max(100) }).strict().refine(position => position.x + position.w <= 12),
    settings: z.record(z.string(), z.unknown()).refine(value => json(value) && JSON.stringify(value).length <= 10000).optional(),
}).strict()).max(50) }).strict();
export class LayoutConflict extends Error {}
export async function readDashboardLayout(userId: string, accountId: string) {
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`dashboard:${userId}:${accountId}`}, 0))`;
        const existing = await tx.dashboardLayout.findFirst({ where: { userId, accountId, isDefault: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { widgets: { orderBy: { sortOrder: 'asc' } } } });
        if (existing) return existing;
        return tx.dashboardLayout.create({ data: { userId, accountId, name: 'Main Dashboard', isDefault: true, widgets: { create: [
            { widgetKey: 'total-sales', position: { x: 0, y: 0, w: 4, h: 4 }, sortOrder: 0 }, { widgetKey: 'recent-orders', position: { x: 4, y: 0, w: 4, h: 4 }, sortOrder: 1 },
            { widgetKey: 'marketing-roas', position: { x: 8, y: 0, w: 4, h: 4 }, sortOrder: 2 }, { widgetKey: 'sales-chart', position: { x: 0, y: 4, w: 8, h: 6 }, sortOrder: 3 },
            { widgetKey: 'top-products', position: { x: 8, y: 4, w: 4, h: 6 }, sortOrder: 4 }, { widgetKey: 'customer-growth', position: { x: 0, y: 10, w: 6, h: 6 }, sortOrder: 5 },
        ] } }, include: { widgets: { orderBy: { sortOrder: 'asc' } } } });
    });
}
export async function saveDashboardLayout(userId: string, accountId: string, body: z.infer<typeof layoutSchema>) {
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`dashboard:${userId}:${accountId}`}, 0))`;
        const layout = await tx.dashboardLayout.findFirst({ where: { userId, accountId, isDefault: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
        if (!layout || layout.updatedAt.toISOString() !== body.version) throw new LayoutConflict();
        const changed = await tx.dashboardLayout.updateMany({ where: { id: layout.id, userId, accountId, updatedAt: layout.updatedAt }, data: { updatedAt: new Date(Math.max(Date.now(), layout.updatedAt.getTime() + 1)) } });
        if (changed.count !== 1) throw new LayoutConflict();
        await tx.dashboardWidget.deleteMany({ where: { dashboardId: layout.id } });
        await tx.dashboardWidget.createMany({ data: body.widgets.map((widget, sortOrder) => ({ dashboardId: layout.id, widgetKey: widget.widgetKey, position: widget.position, settings: widget.settings as object ?? {}, sortOrder })) });
        return tx.dashboardLayout.findUniqueOrThrow({ where: { id: layout.id }, include: { widgets: { orderBy: { sortOrder: 'asc' } } } });
    });
}
