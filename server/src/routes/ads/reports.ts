/**
 * Executive Report Routes
 * 
 * API endpoints for generating and managing executive PDF reports.
 * Part of AI Co-Pilot v2 - Phase 5: Executive Report Generation.
 */

import { FastifyPluginAsync } from 'fastify';
import fs from 'fs';
import { z } from 'zod';
import { requireAuthFastify } from '../../middleware/auth';
import { ExecutiveReportService } from '../../services/ads/ExecutiveReportService';
import { getAdsAccountIdOrReply } from './routeHelpers';

const generateReportBodySchema = z.object({
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    includeAiSummary: z.boolean().optional()
});

const executiveReportParamsSchema = z.object({
    id: z.string().uuid()
});

const historyQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional()
});

function parseDateRangeOrReply(startDate: string, endDate: string, reply: any) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        reply.status(400).send({ error: 'Invalid date format' });
        return null;
    }

    if (start > end) {
        reply.status(400).send({ error: 'startDate must be before endDate' });
        return null;
    }

    return { start, end };
}

function parseWithErrorOrReply<T>(
    schema: z.ZodType<T>,
    value: unknown,
    reply: any,
    error: string,
    includeDetails: boolean = false,
): T | null {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        return reply.status(400).send(
            includeDetails
                ? { error, details: parsed.error?.flatten?.() ?? parsed.error?.issues ?? [] }
                : { error },
        );
    }
    return parsed.data;
}

async function getReportOrReply(id: string, accountId: string, reply: any) {
    const report = await ExecutiveReportService.getReport(id, accountId);
    if (!report) {
        reply.status(404).send({ error: 'Report not found' });
        return null;
    }
    return report;
}

const reportsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * Generate a new executive report.
     * POST /api/ads/reports/executive
     */
    fastify.post('/executive', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;
        const userId = (request.user as any)?.id;
        const parsedBody = parseWithErrorOrReply(
            generateReportBodySchema,
            request.body,
            reply,
            'Invalid request body',
            true,
        );
        if (!parsedBody) return;

        const { startDate, endDate, includeAiSummary } = parsedBody;
        const dateRange = parseDateRangeOrReply(startDate, endDate, reply);
        if (!dateRange) return;
        const { start, end } = dateRange;

        const result = await ExecutiveReportService.generateReport(accountId, {
            startDate: start,
            endDate: end,
            includeAiSummary: includeAiSummary !== false,
            generatedBy: userId
        });

        return {
            success: true,
            report: result
        };
    });

    /**
     * Download a generated report.
     * GET /api/ads/reports/executive/:id
     */
    fastify.get('/executive/:id', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;
        const parsedParams = parseWithErrorOrReply(
            executiveReportParamsSchema,
            request.params,
            reply,
            'Invalid report id',
        );
        if (!parsedParams) return;
        const { id } = parsedParams;

        const report = await getReportOrReply(id, accountId, reply);
        if (!report) return;

        if (!fs.existsSync(report.filePath)) {
            return reply.status(404).send({
                error: 'Report file not found'
            });
        }

        const stream = fs.createReadStream(report.filePath);

        return reply
            .type('application/pdf')
            .header('Content-Disposition', `attachment; filename="${report.fileName}"`)
            .send(stream);
    });

    /**
     * List generated reports.
     * GET /api/ads/reports/history
     */
    fastify.get('/history', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;
        const parsedQuery = parseWithErrorOrReply(
            historyQuerySchema,
            request.query,
            reply,
            'Invalid query parameters',
            true,
        );
        if (!parsedQuery) return;

        const limit = parsedQuery.limit ?? 10;

        const reports = await ExecutiveReportService.listReports(accountId, limit);

        return {
            reports: reports.map(r => ({
                id: r.id,
                periodStart: r.periodStart,
                periodEnd: r.periodEnd,
                fileName: r.fileName,
                fileSize: r.fileSize,
                createdAt: r.createdAt,
                downloadUrl: `/api/ads/reports/executive/${r.id}`
            }))
        };
    });

    /**
     * Delete a report.
     * DELETE /api/ads/reports/executive/:id
     */
    fastify.delete('/executive/:id', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;
        const parsedParams = parseWithErrorOrReply(
            executiveReportParamsSchema,
            request.params,
            reply,
            'Invalid report id',
        );
        if (!parsedParams) return;
        const { id } = parsedParams;

        const report = await getReportOrReply(id, accountId, reply);
        if (!report) return;

        await ExecutiveReportService.deleteReport(id, accountId);

        return { success: true };
    });
};

export default reportsRoutes;
