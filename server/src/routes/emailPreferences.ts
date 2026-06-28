import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { emailListService } from '../services/EmailListService';
import { prisma } from '../utils/prisma';
import { decrypt } from '../utils/encryption';
import { Logger } from '../utils/logger';

const PreferenceLookupSchema = z.object({
    accountId: z.string().uuid(),
    email: z.string().email()
});

const PreferenceUpdateSchema = PreferenceLookupSchema.extend({
    listIds: z.array(z.string()).default([]),
    marketingSubscribed: z.boolean().optional(),
    globalSubscribed: z.boolean().optional(),
    reason: z.string().optional()
});

function extractCredential(headers: Record<string, unknown>): string | undefined {
    const webhookSecret = headers['x-overseek-webhook-secret'];
    if (typeof webhookSecret === 'string' && webhookSecret.trim()) return webhookSecret.trim();

    const authorization = headers.authorization;
    if (typeof authorization !== 'string') return undefined;

    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || undefined;
}

async function verifyPreferenceRequest(accountId: string, credential: string | undefined): Promise<boolean> {
    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { webhookSecret: true }
    });

    if (!account) return false;

    if (credential && account.webhookSecret && credential === account.webhookSecret) {
        return true;
    }

    if (!credential) return false;

    const relayAccounts = await prisma.emailAccount.findMany({
        where: { accountId, relayApiKey: { not: null } },
        select: { id: true, relayApiKey: true }
    });

    for (const relayAccount of relayAccounts) {
        try {
            if (relayAccount.relayApiKey && decrypt(relayAccount.relayApiKey) === credential) {
                return true;
            }
        } catch (error) {
            Logger.warn('Failed to decrypt relay API key during email preference auth', {
                accountId,
                emailAccountId: relayAccount.id,
                error
            });
        }
    }

    return false;
}

async function buildPreferences(accountId: string, email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const [listPreferences, suppression] = await Promise.all([
        emailListService.getEmailListPreferences(accountId, normalizedEmail),
        prisma.emailUnsubscribe.findFirst({
            where: {
                accountId,
                email: { equals: normalizedEmail, mode: 'insensitive' }
            },
            select: { scope: true, reason: true, createdAt: true }
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
}

const emailPreferencesRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get<{ Querystring: z.infer<typeof PreferenceLookupSchema> }>('/', async (request, reply) => {
        const parsed = PreferenceLookupSchema.safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });

        const allowed = await verifyPreferenceRequest(parsed.data.accountId, extractCredential(request.headers));
        if (!allowed) return reply.code(401).send({ error: 'Unauthorized' });

        return buildPreferences(parsed.data.accountId, parsed.data.email);
    });

    fastify.post('/', async (request, reply) => {
        const parsed = PreferenceUpdateSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid input' });

        const allowed = await verifyPreferenceRequest(parsed.data.accountId, extractCredential(request.headers));
        if (!allowed) return reply.code(401).send({ error: 'Unauthorized' });

        const normalizedEmail = parsed.data.email.trim().toLowerCase();

        await emailListService.setBulkSubscriptions(
            parsed.data.accountId,
            normalizedEmail,
            parsed.data.listIds,
            'PLUGIN'
        );

        const unsubscribeAll = parsed.data.globalSubscribed === false;
        const unsubscribeMarketing = parsed.data.marketingSubscribed === false;

        if (unsubscribeAll || unsubscribeMarketing) {
            await prisma.$transaction(async (tx) => {
                await tx.emailUnsubscribe.deleteMany({
                    where: {
                        accountId: parsed.data.accountId,
                        email: { equals: normalizedEmail, mode: 'insensitive' },
                        NOT: { email: normalizedEmail }
                    }
                });

                await tx.emailUnsubscribe.upsert({
                    where: {
                        accountId_email: {
                            accountId: parsed.data.accountId,
                            email: normalizedEmail
                        }
                    },
                    create: {
                        accountId: parsed.data.accountId,
                        email: normalizedEmail,
                        scope: unsubscribeAll ? 'ALL' : 'MARKETING',
                        reason: parsed.data.reason?.trim() || 'Preference center update'
                    },
                    update: {
                        scope: unsubscribeAll ? 'ALL' : 'MARKETING',
                        reason: parsed.data.reason?.trim() || 'Preference center update'
                    }
                });
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

export default emailPreferencesRoutes;
