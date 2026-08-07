/**
 * Customers Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CustomersService } from '../services/customers';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { handleRouteError } from '../utils/errors';
import { parseAdvancedFilters } from './routeHelpers';

const customersRoutes: FastifyPluginAsync = async (fastify) => {
    const AbnSchema = z.string().trim().transform(value => value.replace(/\D/g, '')).refine(value => {
        if (!value) return true;
        if (!/^\d{11}$/.test(value)) return false;
        const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
        const sum = value.split('').reduce((total, digit, index) => total + (Number(digit) - (index === 0 ? 1 : 0)) * weights[index], 0);
        return sum % 89 === 0;
    }, 'Invalid ABN');
    const ContactStatusSchema = z.object({
        status: z.enum(['UNVERIFIED', 'SUBSCRIBED', 'BOUNCED', 'UNSUBSCRIBED', 'SOFT_BOUNCED', 'COMPLAINT'])
    });
    const CustomerProfileSchema = z.object({
        firstName: z.string().trim().max(100),
        lastName: z.string().trim().max(100),
        email: z.string().trim().email().toLowerCase(),
        phone: z.string().trim().max(50).optional(),
        company: z.string().trim().max(200).optional(),
        abn: AbnSchema.optional(),
        address1: z.string().trim().max(200).optional(),
        address2: z.string().trim().max(200).optional(),
        city: z.string().trim().max(100).optional(),
        state: z.string().trim().max(100).optional(),
        postcode: z.string().trim().max(30).optional(),
        country: z.string().trim().toUpperCase().regex(/^([A-Z]{2})?$/, 'Invalid country code').optional()
    });

    // Apply auth to all routes in this plugin
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/', async (request, reply) => {
        try {
            const accountId = request.accountId!;

            const query = request.query as {
                page?: string;
                limit?: string;
                q?: string;
                status?: 'UNVERIFIED' | 'SUBSCRIBED' | 'BOUNCED' | 'UNSUBSCRIBED' | 'SOFT_BOUNCED' | 'COMPLAINT' | 'ALL';
                filters?: string;
            };
            const page = parseInt(query.page || '1', 10);
            const limit = parseInt(query.limit || '20', 10);
            const q = query.q || '';
            const status = query.status || 'ALL';
            const parsedFilters = parseAdvancedFilters(query.filters);

            const result = await CustomersService.searchCustomers(accountId, q, page, limit, status, parsedFilters);
            return result;
        } catch (error) {
            Logger.error('Failed to fetch customers', { error });
            return handleRouteError(error, reply, 'Failed to fetch customers');
        }
    });

    fastify.get('/contacts', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const query = request.query as {
                page?: string;
                limit?: string;
                q?: string;
                status?: 'UNVERIFIED' | 'SUBSCRIBED' | 'BOUNCED' | 'UNSUBSCRIBED' | 'SOFT_BOUNCED' | 'COMPLAINT' | 'BLOCKED' | 'ALL';
            };
            const page = Math.max(parseInt(query.page || '1', 10) || 1, 1);
            const limit = Math.min(Math.max(parseInt(query.limit || '20', 10) || 20, 1), 100);
            const parsedStatus = z.enum([
                'UNVERIFIED',
                'SUBSCRIBED',
                'BOUNCED',
                'UNSUBSCRIBED',
                'SOFT_BOUNCED',
                'COMPLAINT',
                'BLOCKED',
                'ALL'
            ]).safeParse(query.status || 'ALL');
            if (!parsedStatus.success) {
                return reply.code(400).send({ error: 'Invalid status value' });
            }

            return await CustomersService.searchContacts(
                accountId,
                query.q || '',
                page,
                limit,
                parsedStatus.data
            );
        } catch (error) {
            Logger.error('Failed to fetch contacts', { error });
            return handleRouteError(error, reply, 'Failed to fetch contacts');
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

    fastify.put<{ Params: { id: string } }>('/:id/profile', async (request, reply) => {
        try {
            const parsed = CustomerProfileSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: 'Invalid profile details', details: parsed.error.flatten() });
            }
            const customer = await CustomersService.updateCustomerProfile(request.accountId!, request.params.id, parsed.data);
            if (!customer) return reply.code(404).send({ error: 'Customer not found' });
            return { success: true, customer };
        } catch (error) {
            Logger.error('Update Customer Profile Error', { error });
            return handleRouteError(error, reply, 'Failed to update customer profile');
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

    fastify.put<{ Params: { id: string } }>('/:id/contact-status', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const customerId = request.params.id;
            const parsed = ContactStatusSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ error: 'Invalid status value' });
            }

            const result = await CustomersService.updateContactStatus(accountId, customerId, parsed.data.status);
            if (!result) {
                return reply.code(404).send({ error: 'Customer not found' });
            }

            return { success: true, ...result };
        } catch (error) {
            Logger.error('Update Contact Status Error', { error });
            return handleRouteError(error, reply, 'Failed to update contact status');
        }
    });
};

export default customersRoutes;
