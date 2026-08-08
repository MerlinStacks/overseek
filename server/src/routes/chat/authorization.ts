import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../utils/prisma';

export async function requireInboxMutationAccess(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const userId = request.user?.id;
    const accountId = request.accountId;
    if (!userId || !accountId) {
        reply.code(401).send({ error: 'Unauthorized' });
        return false;
    }

    if (request.user?.isSuperAdmin) return true;

    const membership = await prisma.accountUser.findUnique({
        where: { userId_accountId: { userId, accountId } },
        select: { role: true }
    });
    if (!membership || membership.role === 'VIEWER') {
        reply.code(403).send({ error: 'Inbox mutation access required' });
        return false;
    }

    return true;
}
