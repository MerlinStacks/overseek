/**
 * Executive Report Routes
 * 
 * API endpoints for generating and managing executive PDF reports.
 * Part of AI Co-Pilot v2 - Phase 5: Executive Report Generation.
 */

import { FastifyPluginAsync } from 'fastify';
import fs from 'fs';
import { requireAuthFastify } from '../../middleware/auth';
import { ExecutiveReportService } from '../../services/ads/ExecutiveReportService';

interface GenerateReportBody {
    startDate: string;
    endDate: string;
    includeAiSummary?: boolean;
}

const reportsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * Generate a new executive report.
     * POST /api/ads/reports/executive
     */
    fastify.post<{ Body: GenerateReportBody }>('/executive', async (request, reply) => {
        const accountId = request.accountId;
        const userId = (request.user as any)?.id;
        const { startDate, endDate, includeAiSummary } = request.body;

        if (!accountId) {
            return reply.status(400).send({ error: 'No account selected' });
        }

        if (!startDate || !endDate) {
            return reply.status(400).send({
                error: 'Missing required fields: startDate and endDate'
            });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return reply.status(400).send({
                error: 'Invalid date format'
            });
        }

        if (start > end) {
            return reply.status(400).send({
                error: 'startDate must be before endDate'
            });
        }

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
    fastify.get<{ Params: { id: string } }>('/executive/:id', async (request, reply) => {
        const accountId = request.accountId;
        const { id } = request.params;

        if (!accountId) {
            return reply.status(400).send({ error: 'No account selected' });
        }

        const report = await ExecutiveReportService.getReport(id, accountId);

        if (!report) {
            return reply.status(404).send({
                error: 'Report not found'
            });
        }

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
    fastify.get<{ Querystring: { limit?: string } }>('/history', async (request, reply) => {
        const accountId = request.accountId;

        if (!accountId) {
            return reply.status(400).send({ error: 'No account selected' });
        }

        const limit = parseInt(request.query.limit || '10', 10);

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
    fastify.delete<{ Params: { id: string } }>('/executive/:id', async (request, reply) => {
        const accountId = request.accountId;
        const { id } = request.params;

        if (!accountId) {
            return reply.status(400).send({ error: 'No account selected' });
        }

        const report = await ExecutiveReportService.getReport(id, accountId);

        if (!report) {
            return reply.status(404).send({
                error: 'Report not found'
            });
        }

        await ExecutiveReportService.deleteReport(id, accountId);

        return { success: true };
    });
};

export default reportsRoutes;
