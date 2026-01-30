/**
 * Segments Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { segmentService } from '../services/SegmentService';
import { Logger } from '../utils/logger';

const segmentsRoutes: FastifyPluginAsync = async (fastify) => {
    // Apply auth to all routes
    fastify.addHook('preHandler', requireAuthFastify);

    // List Segments
    fastify.get('/', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const segments = await segmentService.listSegments(accountId);
            return segments;
        } catch (error) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to list segments' });
        }
    });

    // Create Segment
    fastify.post('/', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const segment = await segmentService.createSegment(accountId, request.body as any);
            return segment;
        } catch (error) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to create segment' });
        }
    });

    // Get Segment
    fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const segment = await segmentService.getSegment(request.params.id, accountId);
            if (!segment) return reply.code(404).send({ error: 'Segment not found' });
            return segment;
        } catch (error) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to get segment' });
        }
    });

    // Update Segment
    fastify.put<{ Params: { id: string } }>('/:id', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            await segmentService.updateSegment(request.params.id, accountId, request.body as any);
            return { success: true };
        } catch (error) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to update segment' });
        }
    });

    // Delete Segment
    fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            await segmentService.deleteSegment(request.params.id, accountId);
            return { success: true };
        } catch (error) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to delete segment' });
        }
    });

    // Preview Customers in Segment
    fastify.get<{ Params: { id: string } }>('/:id/preview', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const customers = await segmentService.previewCustomers(accountId, request.params.id);
            return customers;
        } catch (error) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to preview segment' });
        }
    });

    /**
     * Export segment customers to CSV.
     * Returns customer data as downloadable CSV file.
     */
    fastify.get<{ Params: { id: string } }>('/:id/export', async (request, reply) => {
        const accountId = request.accountId!;

        try {
            const segment = await segmentService.getSegment(request.params.id, accountId);
            if (!segment) {
                return reply.code(404).send({ error: 'Segment not found' });
            }

            // Get all customers in the segment
            const customers = await segmentService.getCustomerIdsInSegment(accountId, request.params.id);

            // We need full customer data for export, so fetch it
            const { prisma } = await import('../utils/prisma');
            const fullCustomers = await prisma.wooCustomer.findMany({
                where: {
                    accountId,
                    id: { in: customers.map(c => c.id) }
                },
                select: {
                    wooId: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    ordersCount: true,
                    totalSpent: true,
                    createdAt: true
                }
            });

            // Generate CSV content
            const headers = ['WooCommerce ID', 'Email', 'First Name', 'Last Name', 'Orders Count', 'Total Spent', 'Created Date'];

            const escapeCSV = (value: any): string => {
                if (value === null || value === undefined) return '';
                const str = String(value);
                // Escape quotes and wrap in quotes if contains comma, quote, or newline
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            };

            const rows = fullCustomers.map(c => [
                escapeCSV(c.wooId),
                escapeCSV(c.email),
                escapeCSV(c.firstName),
                escapeCSV(c.lastName),
                escapeCSV(c.ordersCount),
                escapeCSV(c.totalSpent?.toString()),
                escapeCSV(c.createdAt?.toISOString().split('T')[0])
            ].join(','));

            const csvContent = [headers.join(','), ...rows].join('\n');

            // Sanitize segment name for filename
            const safeFileName = segment.name.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
            const timestamp = new Date().toISOString().split('T')[0];

            reply.header('Content-Type', 'text/csv; charset=utf-8');
            reply.header('Content-Disposition', `attachment; filename="${safeFileName}_${timestamp}.csv"`);

            Logger.info('Segment exported to CSV', {
                segmentId: segment.id,
                segmentName: segment.name,
                customerCount: fullCustomers.length
            });

            return csvContent;
        } catch (error) {
            Logger.error('Failed to export segment', { error });
            return reply.code(500).send({ error: 'Failed to export segment' });
        }
    });
};

export default segmentsRoutes;
