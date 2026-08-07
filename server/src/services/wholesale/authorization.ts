import { prisma } from '../../utils/prisma';

export function isWholesaleDefaultsApprover(role: string | null | undefined) {
    return role === 'OWNER' || role === 'ADMIN';
}

export async function hasWholesaleAccountMembership(
    userId: string,
    accountId: string,
    lookup: (userId: string, accountId: string) => Promise<unknown> = async (id, account) => (prisma as any).accountUser.findUnique({
        where: { userId_accountId: { userId: id, accountId: account } }, select: { id: true },
    }),
) {
    return !!await lookup(userId, accountId);
}
