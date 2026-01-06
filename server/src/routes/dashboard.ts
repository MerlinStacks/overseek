import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../utils/prisma';

const router = Router();

router.use(requireAuth);

// GET Layout
router.get('/', async (req: Request, res: Response) => {
    const accountId = (req as any).accountId;
    if (!accountId) return res.status(400).json({ error: 'No account' });

    // For now, simple logic: Get the First dashboard for this account/user combo, or create default.
    let layout = await prisma.dashboardLayout.findFirst({
        where: { accountId, userId: (req as any).user.id },
        include: { widgets: true }
    });

    if (!layout) {
        // Create Default
        layout = await prisma.dashboardLayout.create({
            data: {
                accountId,
                userId: (req as any).user.id,
                name: 'Main Dashboard',
                isDefault: true,
                widgets: {
                    create: [
                        { widgetKey: 'total-sales', position: { x: 0, y: 0, w: 4, h: 4 } },
                        { widgetKey: 'recent-orders', position: { x: 4, y: 0, w: 4, h: 4 } },
                        { widgetKey: 'marketing-roas', position: { x: 8, y: 0, w: 4, h: 4 } },
                        { widgetKey: 'sales-chart', position: { x: 0, y: 4, w: 8, h: 6 } },
                        { widgetKey: 'top-products', position: { x: 8, y: 4, w: 4, h: 6 } },
                        { widgetKey: 'customer-growth', position: { x: 0, y: 10, w: 6, h: 6 } }
                    ]
                }
            },
            include: { widgets: true }
        });
    }

    res.json(layout);
});

// SAVE Layout (Widgets Update)
// Expects: { widgets: [{ id?, widgetKey, position, settings }] }
router.post('/', async (req: Request, res: Response) => {
    const accountId = (req as any).accountId;
    if (!accountId) return res.status(400).json({ error: 'No account' });

    // Find ID
    const layout = await prisma.dashboardLayout.findFirst({
        where: { accountId, userId: (req as any).user.id }
    });

    if (!layout) return res.status(404).json({ error: 'Dashboard not found' });

    const { widgets } = req.body;

    // Transaction: Delete existing and re-create? Or Upsert?
    // Delete/Re-create is easiest for complete layout sync.
    // CAUTION: Losing custom settings if we just delete?
    // Better: Upsert by ID if provided, delete missing.

    // MVP: Delete all widgets for this dashboard and insert new ones (safest/easiest synchronization)
    await prisma.$transaction([
        prisma.dashboardWidget.deleteMany({ where: { dashboardId: layout.id } }),
        prisma.dashboardWidget.createMany({
            data: widgets.map((w: any) => ({
                dashboardId: layout.id,
                widgetKey: w.widgetKey,
                position: w.position,
                settings: w.settings || {}
            }))
        })
    ]);

    const updated = await prisma.dashboardLayout.findUnique({
        where: { id: layout.id },
        include: { widgets: true }
    });

    res.json(updated);
});

export default router;
