/**
 * Analytics Reports Routes
 * 
 * Template and schedule management for scheduled reports.
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { prisma } from '../utils/prisma';

const router = Router();

// System Templates Config
const SYSTEM_TEMPLATES = [
    { id: 'sys_overview', name: 'Overview', type: 'SYSTEM', config: { dimension: 'day', metrics: ['sales', 'orders', 'aov'], dateRange: '30d' } },
    { id: 'sys_products', name: 'Product Performance', type: 'SYSTEM', config: { dimension: 'product', metrics: ['quantity', 'sales'], dateRange: '30d' } },
    { id: 'sys_top_sellers', name: 'Top Sellers (90d)', type: 'SYSTEM', config: { dimension: 'product', metrics: ['sales'], dateRange: '90d' } },
    { id: 'sys_bought_together', name: 'Frequent Orders (Proxy)', type: 'SYSTEM', config: { dimension: 'product', metrics: ['orders'], dateRange: '90d' } }
];

const SYSTEM_CONFIGS: Record<string, any> = {
    'sys_overview': { dimension: 'day', metrics: ['sales', 'orders', 'aov'], dateRange: '30d' },
    'sys_products': { dimension: 'product', metrics: ['quantity', 'sales'], dateRange: '30d' },
    'sys_top_sellers': { dimension: 'product', metrics: ['sales'], dateRange: '90d' },
    'sys_bought_together': { dimension: 'product', metrics: ['orders'], dateRange: '90d' },
};

// Templates
router.get('/templates', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const userTemplates = await prisma.reportTemplate.findMany({
            where: { accountId }, orderBy: { createdAt: 'desc' }
        });
        res.json([...SYSTEM_TEMPLATES, ...userTemplates]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/templates', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { name, config } = req.body;
        const template = await prisma.reportTemplate.create({
            data: { accountId, name, config, type: 'CUSTOM' }
        });
        res.json(template);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/templates/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        await prisma.reportTemplate.delete({ where: { id: req.params.id, accountId } });
        res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Schedules
router.get('/schedules', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const schedules = await prisma.reportSchedule.findMany({
            where: { accountId }, include: { template: true }
        });
        res.json(schedules);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/schedules', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const { templateId, frequency, dayOfWeek, dayOfMonth, time, emailRecipients, isActive } = req.body;

        let targetTemplateId = templateId;

        if (templateId.startsWith('sys_')) {
            const config = SYSTEM_CONFIGS[templateId];
            if (!config) return res.status(400).json({ error: 'Invalid System Template' });

            const clone = await prisma.reportTemplate.create({
                data: { accountId, name: `System Clone: ${templateId}`, type: 'SYSTEM_CLONE', config }
            });
            targetTemplateId = clone.id;
        }

        const schedule = await prisma.reportSchedule.create({
            data: { accountId, reportTemplateId: targetTemplateId, frequency, dayOfWeek, dayOfMonth, time, emailRecipients, isActive: isActive ?? true }
        });
        res.json(schedule);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
