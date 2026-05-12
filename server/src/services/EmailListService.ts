import { prisma } from '../utils/prisma';

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export class EmailListService {
    async listLists(accountId: string) {
        return prisma.emailList.findMany({
            where: { accountId, isActive: true },
            include: {
                _count: {
                    select: {
                        memberships: {
                            where: { isSubscribed: true }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
    }

    async createList(accountId: string, data: { name: string; description?: string }) {
        return prisma.emailList.create({
            data: {
                accountId,
                name: data.name.trim(),
                description: data.description?.trim() || null
            }
        });
    }

    async updateList(accountId: string, listId: string, data: { name?: string; description?: string; isActive?: boolean }) {
        return prisma.emailList.updateMany({
            where: { id: listId, accountId },
            data: {
                ...(data.name !== undefined ? { name: data.name.trim() } : {}),
                ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
                ...(data.isActive !== undefined ? { isActive: data.isActive } : {})
            }
        });
    }

    async deleteList(accountId: string, listId: string) {
        return prisma.emailList.updateMany({
            where: { id: listId, accountId },
            data: { isActive: false }
        });
    }

    async listMembers(accountId: string, listId: string) {
        return prisma.emailListMember.findMany({
            where: { accountId, listId },
            orderBy: { updatedAt: 'desc' }
        });
    }

    async setMemberSubscription(accountId: string, listId: string, email: string, subscribed: boolean, source = 'ADMIN') {
        const normalizedEmail = normalizeEmail(email);
        const customer = await prisma.wooCustomer.findFirst({
            where: { accountId, email: { equals: normalizedEmail, mode: 'insensitive' } },
            select: { id: true }
        });

        return prisma.emailListMember.upsert({
            where: { listId_email: { listId, email: normalizedEmail } },
            create: {
                accountId,
                listId,
                email: normalizedEmail,
                wooCustomerId: customer?.id || null,
                isSubscribed: subscribed,
                source,
                subscribedAt: subscribed ? new Date() : null,
                unsubscribedAt: subscribed ? null : new Date()
            },
            update: {
                isSubscribed: subscribed,
                source,
                wooCustomerId: customer?.id || null,
                subscribedAt: subscribed ? new Date() : undefined,
                unsubscribedAt: subscribed ? null : new Date()
            }
        });
    }

    async setBulkSubscriptions(accountId: string, email: string, listIds: string[], source = 'CUSTOMER') {
        const normalizedEmail = normalizeEmail(email);
        const activeLists = await prisma.emailList.findMany({
            where: { accountId, isActive: true },
            select: { id: true }
        });
        const activeIds = new Set(activeLists.map((l) => l.id));
        const desiredIds = new Set(listIds.filter((id) => activeIds.has(id)));

        for (const list of activeLists) {
            await this.setMemberSubscription(accountId, list.id, normalizedEmail, desiredIds.has(list.id), source);
        }
    }

    async getEmailListPreferences(accountId: string, email: string) {
        const normalizedEmail = normalizeEmail(email);
        const [lists, memberships] = await Promise.all([
            prisma.emailList.findMany({
                where: { accountId, isActive: true },
                select: { id: true, name: true, description: true }
            }),
            prisma.emailListMember.findMany({
                where: { accountId, email: normalizedEmail },
                select: { listId: true, isSubscribed: true, updatedAt: true }
            })
        ]);

        const membershipMap = new Map(memberships.map((m) => [m.listId, m]));

        return lists.map((list) => ({
            ...list,
            isSubscribed: membershipMap.get(list.id)?.isSubscribed ?? false,
            updatedAt: membershipMap.get(list.id)?.updatedAt ?? null
        }));
    }
}

export const emailListService = new EmailListService();
