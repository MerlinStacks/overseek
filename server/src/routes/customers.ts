/**
 * Customers Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { CustomersService } from '../services/customers';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { handleRouteError } from '../utils/errors';

const customersRoutes: FastifyPluginAsync = async (fastify) => {
    // Apply auth to all routes in this plugin
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/', async (request, reply) => {
        try {
            const accountId = request.accountId!;

            const query = request.query as { page?: string; limit?: string; q?: string };
            const page = parseInt(query.page || '1');
            const limit = parseInt(query.limit || '20');
            const q = query.q || '';

            const result = await CustomersService.searchCustomers(accountId, q, page, limit);
            return result;
        } catch (error) {
            Logger.error('Failed to fetch customers', { error });
            return handleRouteError(error, reply, 'Failed to fetch customers');
        }
    });

    fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const customerId = request.params.id;

            Logger.debug(`GET /customers/${customerId}`, { accountId });

            const result = await CustomersService.getCustomerDetails(accountId, customerId);

            if (!result) {
                Logger.debug(`Customer not found`, { customerId });
                return reply.code(404).send({ error: 'Customer not found' });
            }

            return result;
        } catch (error) {
            Logger.error('Get Customer Details Error', { error });
            return handleRouteError(error, reply, 'Failed to fetch customer details');
        }
    });

    // Find potential duplicate customers
    fastify.get<{ Params: { id: string } }>('/:id/duplicates', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const customerId = request.params.id;

            const result = await CustomersService.findDuplicates(accountId, customerId);
            return result;
        } catch (error) {
            Logger.error('Find Duplicates Error', { error });
            return handleRouteError(error, reply, 'Failed to find duplicates');
        }
    });

    // Merge source customer into target
    fastify.post<{ Params: { id: string } }>('/:id/merge', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const targetId = request.params.id;
            const { sourceId } = request.body as { sourceId: string };

            if (!sourceId) {
                return reply.code(400).send({ error: 'sourceId is required' });
            }

            const result = await CustomersService.mergeCustomers(accountId, targetId, sourceId);
            return result;
        } catch (error) {
            Logger.error('Merge Customers Error', { error });
            return handleRouteError(error, reply, 'Failed to merge customers');
        }
    });
};

export default customersRoutes;
