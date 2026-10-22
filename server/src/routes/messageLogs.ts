import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { requireAuthFastify } from '../middleware/auth';
import { PermissionService } from '../services/PermissionService';
import { isAccountFeatureEnabled } from '../utils/accountFeatures';

const querySchema = z.object({
    channel: z.enum(['email', 'both', 'sms']).default('both'),
    search: z.string().trim().max(200).default(''),
    status: z.string().max(40).default(''), source: z.string().max(40).default(''),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
});

export const messageLogRoutes: FastifyPluginAsync = async fastify => {
    fastify.get('/logs', { preHandler: requireAuthFastify }, async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId || !request.user?.id) return reply.code(400).send({ error: 'Select an account' });
        if (!await PermissionService.hasPermission(request.user.id, accountId, 'view_marketing')) return reply.code(403).send({ error: 'Marketing permission required' });
        const parsed = querySchema.safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid log filters' });
        const { channel, search, status, source, limit, offset } = parsed.data;
        const emailEnabled = await isAccountFeatureEnabled(accountId, 'EMAIL', true);
        if (channel === 'email' && !emailEnabled) return reply.code(403).send({ error: 'Email feature disabled' });
        // UNION in the database, rather than independently paginating each channel.
        const email = Prisma.sql`SELECT 'email'::text AS channel, e.id, e."to", e.subject, NULL::text AS body,
            e.status, e."errorMessage", e."errorCode", e.source, e."sourceId", e."messageId", e."createdAt",
            a.email AS "from", a.name AS "senderName", e."emailBodyExpiresAt", NULL::integer AS segments,
            NULL::timestamp AS "statusAt"
            FROM "EmailLog" e LEFT JOIN "EmailAccount" a ON a.id = e."emailAccountId" AND a."accountId" = e."accountId"
            WHERE e."accountId" = ${accountId} AND ${emailEnabled && channel !== 'sms'}`;
        const sms = Prisma.sql`SELECT 'sms'::text AS channel, s.id, s."to", NULL::text AS subject, s.body,
            s.status, s."errorMessage", s."errorCode", s.source, s."sourceId", s."messageId", s."createdAt",
            s."from", NULL::text AS "senderName", NULL::timestamp AS "emailBodyExpiresAt", s.segments, s."statusAt"
            FROM "SmsLog" s WHERE s."accountId" = ${accountId} AND ${channel !== 'email'}`;
        const union = Prisma.sql`(${email} UNION ALL ${sms}) messages`;
        // Escape LIKE metacharacters so search is literal, not a wildcard query.
        const needle = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
        const filters = Prisma.sql`WHERE (${status} = '' OR status = ${status}) AND (${source} = '' OR source = ${source})
            AND (${search} = '' OR "to" ILIKE ${needle} OR subject ILIKE ${needle} OR body ILIKE ${needle}
                OR "messageId" ILIKE ${needle} OR "errorMessage" ILIKE ${needle})`;
        const [logs, counts] = await Promise.all([
            prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM ${union} ${filters} ORDER BY "createdAt" DESC, channel ASC, id DESC LIMIT ${limit} OFFSET ${offset}`),
            prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*) AS total FROM ${union} ${filters}`),
        ]);
        return { logs, total: Number(counts[0]?.total || 0), limit, offset };
    });
};
