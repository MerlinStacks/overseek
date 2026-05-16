import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireAuthFastify } from '../../middleware/auth';
import { emailListService } from '../../services/EmailListService';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { parseAdvancedFilters } from '../routeHelpers';

const MAX_BULK_UNSUBSCRIBE_PAYLOAD_CHARS = 2_000_000;
const MAX_BULK_UNSUBSCRIBE_EMAILS = 25_000;
const BULK_UNSUBSCRIBE_RATE_LIMIT = {
    max: 5,
    timeWindow: 60 * 1000
};

const CreateListSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional()
});

const UpdateListSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional()
});

const MemberSchema = z.object({
    email: z.string().email(),
    isSubscribed: z.boolean().optional(),
    source: z.string().optional()
});

const PublicPreferencesSchema = z.object({
    accountId: z.string().min(1),
    email: z.string().email(),
    listIds: z.array(z.string()).default([])
});

const PublicUnifiedPreferencesUpdateSchema = z.object({
    accountId: z.string().min(1),
    email: z.string().email(),
    listIds: z.array(z.string()).default([]),
    marketingSubscribed: z.boolean().optional(),
    globalSubscribed: z.boolean().optional(),
    reason: z.string().optional()
});

const BulkUnsubscribeSchema = z.object({
    emails: z.array(z.string()).optional(),
    payload: z.string().max(MAX_BULK_UNSUBSCRIBE_PAYLOAD_CHARS).optional(),
    scope: z.enum(['MARKETING', 'ALL']).default('MARKETING'),
    reason: z.string().optional()
}).refine((value) => {
    return (value.emails && value.emails.length > 0) || (value.payload && value.payload.trim().length > 0);
}, {
    message: 'Provide at least one email via emails or payload'
});

function extractEmailsFromPayload(payload: string): string[] {
    return payload
        .split(/[\s,;\n\r\t]+/)
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, MAX_BULK_UNSUBSCRIBE_EMAILS);
}

async function verifyAccountSecret(accountId: string, providedSecret?: string) {
    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { webhookSecret: true }
    });
    if (!account) return false;
    if (!account.webhookSecret) return true;
    return providedSecret === account.webhookSecret;
}

const emailListRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/lists', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account context required' });
        return emailListService.listLists(accountId);
    });

    fastify.post('/lists', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account context required' });
        const parsed = CreateListSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });

        try {
            return await emailListService.createList(accountId, parsed.data);
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                return reply.code(409).send({ error: 'A list with this name already exists' });
            }
            Logger.error('Failed to create email list', { error });
            return reply.code(500).send({ error: 'Failed to create list' });
        }
    });

    fastify.put<{ Params: { id: string } }>('/lists/:id', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account context required' });
        const parsed = UpdateListSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });

        const updated = await emailListService.updateList(accountId, request.params.id, parsed.data);
        if (updated.count === 0) return reply.code(404).send({ error: 'List not found' });
        return { success: true };
    });

    fastify.delete<{ Params: { id: string } }>('/lists/:id', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account context required' });
        const deleted = await emailListService.deleteList(accountId, request.params.id);
        if (deleted.count === 0) return reply.code(404).send({ error: 'List not found' });
        return { success: true };
    });

    fastify.get<{ Params: { id: string }; Querystring: { page?: string; pageSize?: string; filters?: string } }>('/lists/:id/members', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account context required' });

        const hasPagination = Boolean(request.query.page || request.query.pageSize || request.query.filters);
        if (!hasPagination) {
            return emailListService.listMembers(accountId, request.params.id);
        }

        const page = Number(request.query.page || 1);
        const pageSize = Number(request.query.pageSize || 25);
        const filters = parseAdvancedFilters(request.query.filters);

        return emailListService.listMembersPaginated(accountId, request.params.id, page, pageSize, filters);
    });

    fastify.post<{ Params: { id: string } }>('/lists/:id/members', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account context required' });
        const parsed = MemberSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });

        return emailListService.setMemberSubscription(
            accountId,
            request.params.id,
            parsed.data.email,
            parsed.data.isSubscribed ?? true,
            parsed.data.source || 'ADMIN'
        );
    });

    fastify.post<{ Body: { email: string; listIds: string[] } }>('/lists/preferences', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account context required' });
        const body = PublicPreferencesSchema.omit({ accountId: true }).safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: 'Invalid input' });

        await emailListService.setBulkSubscriptions(accountId, body.data.email, body.data.listIds, 'CUSTOMER');
        return { success: true };
    });

    fastify.post('/unsubscribes/bulk', {
        config: {
            rateLimit: BULK_UNSUBSCRIBE_RATE_LIMIT
        }
    }, async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account context required' });

        const parsed = BulkUnsubscribeSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });

        const rawEmails = [
            ...(parsed.data.emails || []),
            ...(parsed.data.payload ? extractEmailsFromPayload(parsed.data.payload) : [])
        ];

        if (rawEmails.length > MAX_BULK_UNSUBSCRIBE_EMAILS) {
            return reply.code(400).send({
                error: `Too many emails in a single request. Maximum is ${MAX_BULK_UNSUBSCRIBE_EMAILS}.`,
                maxAllowed: MAX_BULK_UNSUBSCRIBE_EMAILS
            });
        }

        const validator = z.string().email();
        const validEmailSet = new Set<string>();
        const invalidEmails: string[] = [];

        for (const raw of rawEmails) {
            const normalized = raw.trim().toLowerCase();
            if (!normalized) continue;

            const isValid = validator.safeParse(normalized).success;
            if (!isValid) {
                invalidEmails.push(raw);
                continue;
            }

            validEmailSet.add(normalized);
        }

        const validEmails = Array.from(validEmailSet);
        if (validEmails.length === 0) {
            return reply.code(400).send({
                error: 'No valid emails found',
                invalidCount: invalidEmails.length,
                invalidEmails: invalidEmails.slice(0, 20)
            });
        }

        const [matchedCustomers, matchedCustomersWithOrders] = await Promise.all([
            prisma.$queryRaw<Array<{ email: string }>>`
                SELECT DISTINCT lower("email") AS email
                FROM "WooCustomer"
                WHERE "accountId" = ${accountId}
                  AND lower("email") = ANY(${validEmails}::text[])
            `,
            prisma.$queryRaw<Array<{ email: string }>>`
                SELECT DISTINCT lower("email") AS email
                FROM "WooCustomer"
                WHERE "accountId" = ${accountId}
                  AND "ordersCount" > 0
                  AND lower("email") = ANY(${validEmails}::text[])
            `
        ]);

        const matchedCustomerSet = new Set(matchedCustomers.map((row) => row.email));
        const unmatchedEmails = validEmails.filter((email) => !matchedCustomerSet.has(email));

        const existing = await prisma.emailUnsubscribe.findMany({
            where: {
                accountId,
                email: { in: validEmails }
            },
            select: { email: true }
        });

        const existingSet = new Set(existing.map((row) => row.email.toLowerCase()));
        const toCreate = validEmails.filter((email) => !existingSet.has(email));
        const toUpdate = validEmails.filter((email) => existingSet.has(email));

        await prisma.$transaction([
            ...(toCreate.length > 0
                ? [
                    prisma.emailUnsubscribe.createMany({
                        data: toCreate.map((email) => ({
                            accountId,
                            email,
                            scope: parsed.data.scope,
                            reason: parsed.data.reason?.trim() || 'Bulk unsubscribe upload'
                        }))
                    })
                ]
                : []),
            ...(toUpdate.length > 0
                ? [
                    prisma.emailUnsubscribe.updateMany({
                        where: {
                            accountId,
                            email: { in: toUpdate }
                        },
                        data: {
                            scope: parsed.data.scope,
                            reason: parsed.data.reason?.trim() || 'Bulk unsubscribe upload'
                        }
                    })
                ]
                : [])
        ]);

        const updatedCustomerProfiles = await prisma.$executeRaw`
            UPDATE "WooCustomer"
            SET "rawData" = jsonb_set(
                COALESCE("rawData", '{}'::jsonb),
                '{contactStatus}',
                to_jsonb('UNSUBSCRIBED'::text),
                true
            )
            WHERE "accountId" = ${accountId}
              AND lower("email") = ANY(${validEmails}::text[])
        `;

        Logger.info('Bulk unsubscribe applied', {
            accountId,
            processed: validEmails.length,
            customerProfilesUpdated: Number(updatedCustomerProfiles || 0)
        });

        return {
            success: true,
            processed: validEmails.length,
            created: toCreate.length,
            updated: toUpdate.length,
            matchedCustomers: matchedCustomers.length,
            matchedWithOrders: matchedCustomersWithOrders.length,
            unmatchedCount: unmatchedEmails.length,
            unmatchedEmailsSample: unmatchedEmails.slice(0, 20),
            invalidCount: invalidEmails.length,
            invalidEmails: invalidEmails.slice(0, 20)
        };
    });
};

export const emailListPublicRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get<{ Querystring: { accountId: string; email: string } }>('/lists/public/preferences', async (request, reply) => {
        const accountId = request.query.accountId;
        const email = request.query.email;
        const secret = request.headers['x-overseek-webhook-secret'] as string | undefined;

        const allowed = await verifyAccountSecret(accountId, secret);
        if (!allowed) return reply.code(401).send({ error: 'Unauthorized' });

        return {
            success: true,
            accountId,
            email,
            preferences: await emailListService.getEmailListPreferences(accountId, email)
        };
    });

    fastify.post('/lists/public/preferences', async (request, reply) => {
        const parsed = PublicPreferencesSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });

        const secret = request.headers['x-overseek-webhook-secret'] as string | undefined;
        const allowed = await verifyAccountSecret(parsed.data.accountId, secret);
        if (!allowed) return reply.code(401).send({ error: 'Unauthorized' });

        await emailListService.setBulkSubscriptions(parsed.data.accountId, parsed.data.email, parsed.data.listIds, 'PLUGIN');
        return { success: true };
    });

    fastify.get<{ Querystring: { accountId: string; email: string } }>('/preferences/public', async (request, reply) => {
        const accountId = request.query.accountId;
        const email = request.query.email;
        const secret = request.headers['x-overseek-webhook-secret'] as string | undefined;

        const allowed = await verifyAccountSecret(accountId, secret);
        if (!allowed) return reply.code(401).send({ error: 'Unauthorized' });

        const normalizedEmail = email.trim().toLowerCase();
        const [listPreferences, suppression] = await Promise.all([
            emailListService.getEmailListPreferences(accountId, normalizedEmail),
            prisma.emailUnsubscribe.findFirst({
                where: {
                    accountId,
                    email: { equals: normalizedEmail, mode: 'insensitive' }
                },
                select: { id: true, scope: true, reason: true, createdAt: true }
            })
        ]);

        const isGlobalUnsubscribed = suppression?.scope === 'ALL';
        const isMarketingUnsubscribed = suppression?.scope === 'MARKETING' || isGlobalUnsubscribed;

        return {
            success: true,
            accountId,
            email: normalizedEmail,
            preferences: {
                globalSubscribed: !isGlobalUnsubscribed,
                marketingSubscribed: !isMarketingUnsubscribed,
                unsubscribedScope: suppression?.scope || null,
                unsubscribeReason: suppression?.reason || null,
                updatedAt: suppression?.createdAt || null,
                lists: listPreferences
            }
        };
    });

    fastify.post('/preferences/public', async (request, reply) => {
        const parsed = PublicUnifiedPreferencesUpdateSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });

        const secret = request.headers['x-overseek-webhook-secret'] as string | undefined;
        const allowed = await verifyAccountSecret(parsed.data.accountId, secret);
        if (!allowed) return reply.code(401).send({ error: 'Unauthorized' });

        const normalizedEmail = parsed.data.email.trim().toLowerCase();

        await emailListService.setBulkSubscriptions(
            parsed.data.accountId,
            normalizedEmail,
            parsed.data.listIds,
            'PLUGIN'
        );

        const explicitlyUnsubscribeAll = parsed.data.globalSubscribed === false;
        const explicitlyUnsubscribeMarketing = parsed.data.marketingSubscribed === false;

        if (explicitlyUnsubscribeAll || explicitlyUnsubscribeMarketing) {
            await prisma.emailUnsubscribe.upsert({
                where: {
                    accountId_email: {
                        accountId: parsed.data.accountId,
                        email: normalizedEmail
                    }
                },
                create: {
                    accountId: parsed.data.accountId,
                    email: normalizedEmail,
                    scope: explicitlyUnsubscribeAll ? 'ALL' : 'MARKETING',
                    reason: parsed.data.reason?.trim() || 'Preference center update'
                },
                update: {
                    scope: explicitlyUnsubscribeAll ? 'ALL' : 'MARKETING',
                    reason: parsed.data.reason?.trim() || 'Preference center update'
                }
            });
        } else if (parsed.data.globalSubscribed === true || parsed.data.marketingSubscribed === true) {
            await prisma.emailUnsubscribe.deleteMany({
                where: {
                    accountId: parsed.data.accountId,
                    email: { equals: normalizedEmail, mode: 'insensitive' }
                }
            });
        }

        return { success: true };
    });
};

export default emailListRoutes;
