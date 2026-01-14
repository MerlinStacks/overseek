/**
 * Analytics Reports Routes - Fastify Plugin
 * Template and schedule management for scheduled reports.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';

// System Templates Config
const SYSTEM_TEMPLATES = [
    { id: 'sys_overview', name: 'Sales Overview', type: 'SYSTEM', category: 'Sales', config: { dimension: 'day', metrics: ['sales', 'orders', 'aov'], dateRange: '30d' } },
    { id: 'sys_products', name: 'Product Performance', type: 'SYSTEM', category: 'Sales', config: { dimension: 'product', metrics: ['quantity', 'sales', 'orders'], dateRange: '30d' } },
    { id: 'sys_top_sellers', name: 'Top Sellers (90d)', type: 'SYSTEM', category: 'Sales', config: { dimension: 'product', metrics: ['sales', 'quantity'], dateRange: '90d' } },
    { id: 'sys_order_status', name: 'Order Status Breakdown', type: 'SYSTEM', category: 'Sales', config: { dimension: 'order_status', metrics: ['orders', 'sales'], dateRange: '30d' } },
    { id: 'sys_category_performance', name: 'Category Performance', type: 'SYSTEM', category: 'Sales', config: { dimension: 'category', metrics: ['sales', 'orders', 'quantity'], dateRange: '30d' } },
    { id: 'sys_traffic_sources', name: 'Traffic Sources', type: 'SYSTEM', category: 'Traffic', config: { dimension: 'traffic_source', metrics: ['sessions', 'visitors', 'conversion_rate'], dateRange: '30d' } },
    { id: 'sys_campaigns', name: 'Campaign Performance', type: 'SYSTEM', category: 'Traffic', config: { dimension: 'utm_source', metrics: ['sessions', 'sales', 'conversion_rate'], dateRange: '30d' } },
    { id: 'sys_devices', name: 'Device Performance', type: 'SYSTEM', category: 'Traffic', config: { dimension: 'device', metrics: ['sessions', 'sales', 'conversion_rate'], dateRange: '30d' } },
    { id: 'sys_geographic', name: 'Geographic Sales', type: 'SYSTEM', category: 'Customer', config: { dimension: 'country', metrics: ['sales', 'orders', 'sessions'], dateRange: '30d' } },
    { id: 'sys_customer_performance', name: 'Top Customers', type: 'SYSTEM', category: 'Customer', config: { dimension: 'customer', metrics: ['sales', 'orders'], dateRange: '90d' } },
    { id: 'sys_new_customers', name: 'New Customers', type: 'SYSTEM', category: 'Customer', config: { dimension: 'day', metrics: ['new_customers', 'sales'], dateRange: '30d' } },
    { id: 'sys_conversion', name: 'Conversion Report', type: 'SYSTEM', category: 'Conversion', config: { dimension: 'day', metrics: ['sessions', 'orders', 'conversion_rate'], dateRange: '30d' } }
];

const SYSTEM_CONFIGS: Record<string, any> = {
    'sys_overview': { dimension: 'day', metrics: ['sales', 'orders', 'aov'], dateRange: '30d' },
    'sys_products': { dimension: 'product', metrics: ['quantity', 'sales', 'orders'], dateRange: '30d' },
    'sys_top_sellers': { dimension: 'product', metrics: ['sales', 'quantity'], dateRange: '90d' },
    'sys_order_status': { dimension: 'order_status', metrics: ['orders', 'sales'], dateRange: '30d' },
    'sys_category_performance': { dimension: 'category', metrics: ['sales', 'orders', 'quantity'], dateRange: '30d' },
    'sys_traffic_sources': { dimension: 'traffic_source', metrics: ['sessions', 'visitors', 'conversion_rate'], dateRange: '30d' },
    'sys_campaigns': { dimension: 'utm_source', metrics: ['sessions', 'sales', 'conversion_rate'], dateRange: '30d' },
    'sys_devices': { dimension: 'device', metrics: ['sessions', 'sales', 'conversion_rate'], dateRange: '30d' },
    'sys_geographic': { dimension: 'country', metrics: ['sales', 'orders', 'sessions'], dateRange: '30d' },
    'sys_customer_performance': { dimension: 'customer', metrics: ['sales', 'orders'], dateRange: '90d' },
    'sys_new_customers': { dimension: 'day', metrics: ['new_customers', 'sales'], dateRange: '30d' },
    'sys_conversion': { dimension: 'day', metrics: ['sessions', 'orders', 'conversion_rate'], dateRange: '30d' }
};

const analyticsReportsRoutes: FastifyPluginAsync = async (fastify) => {
    // Templates
    fastify.get('/templates', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const userTemplates = await prisma.reportTemplate.findMany({
                where: { accountId }, orderBy: { createdAt: 'desc' }
            });
            return [...SYSTEM_TEMPLATES, ...userTemplates];
        } catch (e: any) { return reply.code(500).send({ error: e.message }); }
    });

    fastify.post('/templates', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const { name, config } = request.body as any;
            const template = await prisma.reportTemplate.create({
                data: { accountId, name, config, type: 'CUSTOM' }
            });
            return template;
        } catch (e: any) { return reply.code(500).send({ error: e.message }); }
    });

    fastify.delete<{ Params: { id: string } }>('/templates/:id', async (request, reply) => {
        try {
            const accountId = request.accountId;
            await prisma.reportTemplate.delete({ where: { id: request.params.id, accountId } });
            return { success: true };
        } catch (e: any) { return reply.code(500).send({ error: e.message }); }
    });

    // Schedules
    fastify.get('/schedules', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const schedules = await prisma.reportSchedule.findMany({
                where: { accountId }, include: { template: true }
            });
            return schedules;
        } catch (e: any) { return reply.code(500).send({ error: e.message }); }
    });

    fastify.post('/schedules', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const { templateId, frequency, dayOfWeek, dayOfMonth, time, emailRecipients, isActive } = request.body as any;

            let targetTemplateId = templateId;

            if (templateId.startsWith('sys_')) {
                const config = SYSTEM_CONFIGS[templateId];
                if (!config) return reply.code(400).send({ error: 'Invalid System Template' });

                const clone = await prisma.reportTemplate.create({
                    data: { accountId, name: `System Clone: ${templateId}`, type: 'SYSTEM_CLONE', config }
                });
                targetTemplateId = clone.id;
            }

            const schedule = await prisma.reportSchedule.create({
                data: { accountId, reportTemplateId: targetTemplateId, reportType: 'CUSTOM', frequency, dayOfWeek, dayOfMonth, time, emailRecipients, isActive: isActive ?? true }
            });
            return schedule;
        } catch (e: any) { return reply.code(500).send({ error: e.message }); }
    });

    // Delete schedule
    fastify.delete<{ Params: { id: string } }>('/schedules/:id', async (request, reply) => {
        try {
            const accountId = request.accountId;
            await prisma.reportSchedule.delete({ where: { id: request.params.id, accountId } });
            return { success: true };
        } catch (e: any) { return reply.code(500).send({ error: e.message }); }
    });

    // Update schedule
    fastify.patch<{ Params: { id: string } }>('/schedules/:id', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const { frequency, dayOfWeek, dayOfMonth, time, emailRecipients, isActive } = request.body as any;

            const schedule = await prisma.reportSchedule.update({
                where: { id: request.params.id, accountId },
                data: {
                    ...(frequency && { frequency }),
                    ...(dayOfWeek !== undefined && { dayOfWeek }),
                    ...(dayOfMonth !== undefined && { dayOfMonth }),
                    ...(time && { time }),
                    ...(emailRecipients && { emailRecipients }),
                    ...(isActive !== undefined && { isActive })
                }
            });
            return schedule;
        } catch (e: any) { return reply.code(500).send({ error: e.message }); }
    });

    // ========================================
    // Digest Schedule Endpoints
    // ========================================

    // Get digest schedules only
    fastify.get('/digests', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const digests = await prisma.reportSchedule.findMany({
                where: { accountId, reportType: 'DIGEST' },
                orderBy: { createdAt: 'desc' }
            });
            return digests;
        } catch (e: any) { return reply.code(500).send({ error: e.message }); }
    });

    // Create a digest schedule
    fastify.post('/digests', async (request, reply) => {
        try {
            const accountId = request.accountId;
            const { frequency, dayOfWeek, time, emailRecipients, isActive } = request.body as any;

            // Validate frequency for digests (only DAILY or WEEKLY)
            if (!['DAILY', 'WEEKLY'].includes(frequency)) {
                return reply.code(400).send({ error: 'Digest frequency must be DAILY or WEEKLY' });
            }

            // Calculate next run time
            const now = new Date();
            const [hour, minute] = (time || '09:00').split(':').map(Number);
            let nextRunAt = new Date();
            nextRunAt.setHours(hour, minute, 0, 0);
            if (nextRunAt <= now) {
                nextRunAt.setDate(nextRunAt.getDate() + 1);
            }

            const schedule = await prisma.reportSchedule.create({
                data: {
                    accountId,
                    reportType: 'DIGEST',
                    reportTemplateId: null,
                    frequency,
                    dayOfWeek: frequency === 'WEEKLY' ? (dayOfWeek || 1) : null,
                    time: time || '09:00',
                    emailRecipients: emailRecipients || [],
                    isActive: isActive ?? true,
                    nextRunAt
                }
            });
            return schedule;
        } catch (e: any) { return reply.code(500).send({ error: e.message }); }
    });
};

export default analyticsReportsRoutes;
