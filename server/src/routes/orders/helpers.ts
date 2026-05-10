import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { parseFirstIssueOrReply } from '../routeHelpers';

export const orderIdParamSchema = z.object({
    id: z.union([
        z.string().uuid(),
        z.string().regex(/^\d+$/, 'ID must be a UUID or a numeric string')
    ])
});

export function getOrderAccountIdOrReply(request: any, reply: any): string | null {
    const accountId = request.user?.accountId;
    if (!accountId) {
        reply.code(400).send({ error: 'accountId header is required' });
        return null;
    }
    return accountId;
}

export function getOrderRequestAccountIdOrReply(request: any, reply: any): string | null {
    const accountId = request.accountId;
    if (!accountId) {
        reply.code(400).send({ error: 'accountId header is required' });
        return null;
    }
    return accountId;
}

export function getOrderUserAndAccountOrReply(
    request: any,
    reply: any,
): { userId: string; accountId: string } | null {
    const userId = request.user?.id;
    const accountId = request.user?.accountId;
    if (!userId || !accountId) {
        reply.code(400).send({ error: 'accountId header is required' });
        return null;
    }
    return { userId, accountId };
}

export function parseOrderIdParamOrReply(request: any, reply: any): string | null {
    const parsed = parseFirstIssueOrReply<{ id: string }>(reply, orderIdParamSchema.safeParse(request.params));
    return parsed?.id ?? null;
}

export async function findOrderByAnyId(accountId: string, id: string) {
    const byInternalId = await prisma.wooOrder.findFirst({ where: { id, accountId } });
    if (byInternalId) return byInternalId;

    if (!isNaN(Number(id))) {
        return prisma.wooOrder.findUnique({
            where: { accountId_wooId: { accountId, wooId: Number(id) } }
        });
    }

    return null;
}
