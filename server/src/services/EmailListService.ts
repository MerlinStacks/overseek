import { prisma } from '../utils/prisma';

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export class EmailListService {
    private buildMemberCondition(condition: { field: string; operator: string; value: string }) {
        const field = String(condition.field || '').trim();
        const operator = String(condition.operator || '').trim().toLowerCase();
        const value = String(condition.value || '').trim();
        if (!field || field === 'Select' || !value) return null;

        if (field === 'Email') {
            if (operator === 'is not') return { NOT: { email: { equals: value, mode: 'insensitive' as const } } };
            if (operator === 'contains') return { email: { contains: value, mode: 'insensitive' as const } };
            return { email: { equals: value, mode: 'insensitive' as const } };
        }

        if (field === 'Name') {
            if (operator === 'is not') {
                return {
                    NOT: {
                        OR: [
                            { wooCustomer: { firstName: { equals: value, mode: 'insensitive' as const } } },
                            { wooCustomer: { lastName: { equals: value, mode: 'insensitive' as const } } }
                        ]
                    }
                };
            }
            if (operator === 'contains') {
                return {
                    OR: [
                        { wooCustomer: { firstName: { contains: value, mode: 'insensitive' as const } } },
                        { wooCustomer: { lastName: { contains: value, mode: 'insensitive' as const } } }
                    ]
                };
            }
            return {
                OR: [
                    { wooCustomer: { firstName: { equals: value, mode: 'insensitive' as const } } },
                    { wooCustomer: { lastName: { equals: value, mode: 'insensitive' as const } } }
                ]
            };
        }

        if (field === 'Contact Status') {
            if (operator === 'is not') return { NOT: { wooCustomer: { rawData: { path: ['contactStatus'], equals: value.toUpperCase() } } } };
            if (operator === 'contains') return { wooCustomer: { rawData: { path: ['contactStatus'], string_contains: value.toUpperCase() } } };
            return { wooCustomer: { rawData: { path: ['contactStatus'], equals: value.toUpperCase() } } };
        }

        if (field === 'Total Spent') {
            const numeric = Number(value);
            if (Number.isNaN(numeric)) return null;
            if (operator === 'greater than') return { wooCustomer: { totalSpent: { gt: numeric } } };
            if (operator === 'less than') return { wooCustomer: { totalSpent: { lt: numeric } } };
            if (operator === 'is not') return { NOT: { wooCustomer: { totalSpent: numeric } } };
            return { wooCustomer: { totalSpent: numeric } };
        }

        if (field === 'Orders') {
            const numeric = Number(value);
            if (Number.isNaN(numeric)) return null;
            if (operator === 'greater than') return { wooCustomer: { ordersCount: { gt: numeric } } };
            if (operator === 'less than') return { wooCustomer: { ordersCount: { lt: numeric } } };
            if (operator === 'is not') return { NOT: { wooCustomer: { ordersCount: numeric } } };
            return { wooCustomer: { ordersCount: numeric } };
        }

        return null;
    }

    private buildMembersAdvancedWhere(filters: Array<{ combinator: 'AND' | 'OR'; conditions: Array<{ field: string; operator: string; value: string }> }>) {
        const groups = (filters || []).map((group) => ({
            combinator: group.combinator === 'OR' ? 'OR' : 'AND',
            conditions: group.conditions.map((condition) => this.buildMemberCondition(condition)).filter(Boolean) as any[]
        })).filter((group) => group.conditions.length > 0);

        if (groups.length === 0) return null;

        let expression: any = { AND: groups[0].conditions };
        for (let index = 1; index < groups.length; index += 1) {
            const groupExpression = { AND: groups[index].conditions };
            expression = groups[index].combinator === 'OR'
                ? { OR: [expression, groupExpression] }
                : { AND: [expression, groupExpression] };
        }

        return expression;
    }
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
        return prisma.emailList.deleteMany({
            where: { id: listId, accountId }
        });
    }

    async listMembers(accountId: string, listId: string) {
        return prisma.emailListMember.findMany({
            where: { accountId, listId },
            orderBy: { updatedAt: 'desc' }
        });
    }

    async listMembersPaginated(
        accountId: string,
        listId: string,
        page = 1,
        pageSize = 25,
        filters: Array<{ combinator: 'AND' | 'OR'; conditions: Array<{ field: string; operator: string; value: string }> }> = []
    ) {
        const safePage = Math.max(1, page);
        const safePageSize = Math.min(100, Math.max(1, pageSize));
        const skip = (safePage - 1) * safePageSize;

        const advancedWhere = this.buildMembersAdvancedWhere(filters);
        const baseWhere: any = { accountId, listId, isSubscribed: true };
        const where = advancedWhere ? { AND: [baseWhere, advancedWhere] } : baseWhere;

        const [members, total] = await Promise.all([
            prisma.emailListMember.findMany({
                where,
                include: {
                    wooCustomer: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true,
                            totalSpent: true,
                            ordersCount: true,
                            rawData: true
                        }
                    }
                },
                orderBy: { updatedAt: 'desc' },
                skip,
                take: safePageSize
            }),
            prisma.emailListMember.count({ where })
        ]);

        const customers = members.map((member) => ({
            id: member.wooCustomerId || member.id,
            firstName: member.wooCustomer?.firstName || '',
            lastName: member.wooCustomer?.lastName || '',
            email: member.wooCustomer?.email || member.email,
            totalSpent: Number(member.wooCustomer?.totalSpent || 0),
            ordersCount: Number(member.wooCustomer?.ordersCount || 0),
            contactStatus: String((member.wooCustomer?.rawData as any)?.contactStatus || 'SUBSCRIBED').toUpperCase()
        }));

        return {
            customers,
            pagination: {
                page: safePage,
                pageSize: safePageSize,
                total,
                totalPages: Math.max(1, Math.ceil(total / safePageSize))
            }
        };
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
