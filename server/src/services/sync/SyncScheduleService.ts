import { prisma } from '../../utils/prisma';

export const SYNC_ENTITY_TYPES = ['orders', 'products', 'customers', 'reviews', 'pages', 'blog-posts', 'bom'] as const;
export type SyncEntityType = typeof SYNC_ENTITY_TYPES[number];

const DEFAULT_INTERVALS: Record<SyncEntityType, number> = {
    orders: 1,
    products: 5,
    customers: 5,
    reviews: 5,
    pages: 15,
    'blog-posts': 15,
    bom: 15
};

export class SyncScheduleService {
    static isEntityType(value: unknown): value is SyncEntityType {
        return typeof value === 'string' && SYNC_ENTITY_TYPES.includes(value as SyncEntityType);
    }

    static async ensureAccountSchedules(accountId: string) {
        const syncSchedule = (prisma as any).syncSchedule;
        await Promise.all(SYNC_ENTITY_TYPES.map(entityType => syncSchedule.upsert({
            where: { accountId_entityType: { accountId, entityType } },
            update: {},
            create: {
                accountId,
                entityType,
                intervalMinutes: DEFAULT_INTERVALS[entityType],
                nextRunAt: new Date(Date.now() + DEFAULT_INTERVALS[entityType] * 60_000)
            }
        })));

        return syncSchedule.findMany({
            where: { accountId },
            orderBy: { entityType: 'asc' }
        });
    }

    static async update(accountId: string, entityType: SyncEntityType, input: { enabled?: boolean; intervalMinutes?: number }) {
        const syncSchedule = (prisma as any).syncSchedule;
        const intervalMinutes = input.intervalMinutes;
        if (intervalMinutes !== undefined && (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440)) {
            throw new Error('intervalMinutes must be a whole number between 1 and 1440');
        }

        await this.ensureAccountSchedules(accountId);
        const data: { enabled?: boolean; intervalMinutes?: number; nextRunAt?: Date } = {};
        if (typeof input.enabled === 'boolean') {
            data.enabled = input.enabled;
            if (input.enabled) data.nextRunAt = new Date();
        }
        if (intervalMinutes !== undefined) {
            data.intervalMinutes = intervalMinutes;
            data.nextRunAt = new Date(Date.now() + intervalMinutes * 60_000);
        }

        return syncSchedule.update({
            where: { accountId_entityType: { accountId, entityType } },
            data
        });
    }

    static async setAllEnabled(accountId: string, enabled: boolean) {
        const syncSchedule = (prisma as any).syncSchedule;
        await this.ensureAccountSchedules(accountId);
        await syncSchedule.updateMany({
            where: { accountId },
            data: enabled ? { enabled: true, nextRunAt: new Date() } : { enabled: false }
        });
        return this.ensureAccountSchedules(accountId);
    }
}
